// ProofPass Doğrulayıcı (Verifier) — ayrı servis. Port: 5000
// Akış:  kiralama sunucusu oturum açar (gizli anahtarla) → tarayıcıdaki cüzdan kanıtı DOĞRUDAN buraya gönderir
//        → kiralama sunucusu buradan yalnızca {age_over_25, license_2y, class_ok} (üç true/false) cevabını alır.
// Kiralama sunucusu proof ve publicSignals değerlerini HİÇ görmez.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const snarkjs = require('snarkjs');

const PORT = Number(process.env.PORT) || 5000;
const PROVIDER = process.env.PROVIDER_URL || 'http://localhost:4000';
const VKEY = JSON.parse(fs.readFileSync(path.join(__dirname, 'vkey.json'), 'utf8'));
const CLIENTS = { privacydrive: { secret: process.env.CLIENT_SECRET || 'privacydrive-demo-secret', origins: ['http://localhost:3000'] } };

let pubCache = { at: 0, v: null };
async function issuerPub() {
  if (pubCache.v && Date.now() - pubCache.at < 30000) return pubCache.v;
  const r = await fetch(PROVIDER + '/api/issuer/pubkey'); if (!r.ok) throw new Error('Sağlayıcıya ulaşılamadı');
  pubCache = { at: Date.now(), v: (await r.json()).pub }; return pubCache.v;
}

const sessions = new Map(); // id -> {client, subject, asOf, nonce, exp, state, result}
setInterval(() => { for (const [k, v] of sessions) if (v.exp < Date.now()) sessions.delete(k); }, 60000).unref();

const json = (res, code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { no(new Error('geçersiz JSON')); } }); });
const cors = req => { const o = req.headers.origin; return Object.values(CLIENTS).some(c => c.origins.includes(o)) ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', Vary: 'Origin' } : {}; };
const authClient = (req, body) => { const id = body.client_id || req.headers['x-client-id']; const c = CLIENTS[id]; const sec = body.client_secret || req.headers['x-client-secret']; return c && sec === c.secret ? id : null; };

const claimsOf = ps => ({ age_over_25: ps[0] === '1', license_2y: ps[1] === '1', class_ok: ps[2] === '1' });

async function checkProof(s, b) {
  const bad = error => ({ error, ms: 0 });
  const ps = (b.publicSignals || []).map(String);
  if (!b.proof || ps.length !== 8) return bad('Eksik veya hatalı alan');
  if (Date.now() > s.exp) return bad('Oturumun süresi doldu');
  const pub = await issuerPub();
  if (ps[3] !== pub.Ax || ps[4] !== pub.Ay) return bad('Kanıt güvenilen veri sağlayıcıya ait değil');
  if (ps[5] !== String(s.asOf)) return bad('Kanıt farklı bir alış tarihi için üretilmiş');
  if (ps[6] !== BigInt('0x' + s.subject.replace(/^s_/, '')).toString()) return bad('Kanıt bu hesaba ait değil');
  if (ps[7] !== BigInt('0x' + s.nonce).toString()) return bad('Nonce kanıtla eşleşmiyor');
  const t = performance.now(); let valid = false;
  try { valid = await snarkjs.groth16.verify(VKEY, ps, b.proof); } catch {}
  const ms = performance.now() - t;
  if (!valid) return { error: 'Kanıt doğrulanamadı (değiştirilmiş veya geçersiz)', ms };
  if (s.state === 'done') return { error: 'Bu oturum zaten kullanıldı (replay reddedildi)', ms };
  s.state = 'done'; s.result = claimsOf(ps);
  return { ok: true, ms };
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true });

    // Kiralama sunucusu → oturum aç
    if (req.method === 'POST' && p === '/api/sessions') {
      const b = await readBody(req); const client = authClient(req, b);
      if (!client) return json(res, 401, { error: 'Yetkisiz kurum' });
      if (!/^s_[0-9a-f]{12}$/.test(b.subject || '') || !/^\d{8}$/.test(String(b.asOf))) return json(res, 400, { error: 'Geçersiz parametre' });
      const id = crypto.randomBytes(16).toString('hex'), nonce = crypto.randomBytes(8).toString('hex');
      sessions.set(id, { client, subject: b.subject, asOf: String(b.asOf), nonce, exp: Date.now() + 120000, state: 'pending', result: null });
      return json(res, 200, { session_id: id, nonce });
    }
    let m;
    // Cüzdan (tarayıcı) → kanıtı doğrudan buraya gönderir. Cevapta yalnızca kabul/ret ve süre vardır.
    if (req.method === 'POST' && (m = p.match(/^\/api\/sessions\/([0-9a-f]{32})\/proof$/))) {
      const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'Bilinmeyen veya süresi dolmuş oturum' }, cors(req));
      const r = await checkProof(s, await readBody(req));
      return json(res, 200, r.ok ? { accepted: true, verify_ms: r.ms } : { accepted: false, error: r.error, verify_ms: r.ms }, cors(req));
    }
    // Kiralama sunucusu → sonucu al: yalnızca true/false
    if (req.method === 'GET' && (m = p.match(/^\/api\/sessions\/([0-9a-f]{32})\/result$/))) {
      const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'Bilinmeyen veya süresi dolmuş oturum' });
      if (authClient(req, {}) !== s.client) return json(res, 401, { error: 'Yetkisiz kurum' });
      return json(res, 200, s.state === 'done' ? { status: 'done', ...s.result } : { status: 'pending' });
    }
    // Yalnızca ölçüm: durumsuz doğrulama (test imzalayıcısı). Hiçbir oturuma dokunmaz.
    if (req.method === 'POST' && p === '/api/bench/verify') {
      const b = await readBody(req), ps = (b.publicSignals || []).map(String);
      if (ps.length !== 8 || !b.proof) return json(res, 400, { error: 'Eksik alan' }, cors(req));
      const t = performance.now(); let valid = false; try { valid = await snarkjs.groth16.verify(VKEY, ps, b.proof); } catch {}
      return json(res, 200, { valid, verify_ms: performance.now() - t, claims: valid ? claimsOf(ps) : null }, cors(req));
    }
    json(res, 404, { error: 'Bulunamadı' });
  } catch (e) { json(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`ProofPass doğrulayıcı: http://localhost:${PORT}  (sağlayıcı: ${PROVIDER})`));
