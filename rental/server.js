// PrivacyDrive — araç kiralama sitesi (ayrı sunucu). Port: 3000
// Bu sunucu KimlikKasası (4000) veritabanına erişemez. Sağlayıcıdan yalnızca şunları alabilir:
//   - açık anahtar (herkese açık)
//   - klasik modda, kullanıcının onayıyla ve gizli anahtarla: ad, T.C. no, doğum tarihi
// ZKP modunda sağlayıcıyla konuşmaz ve kanıtı da GÖRMEZ: cüzdan kanıtı doğrudan Doğrulayıcı servisine (5000) gönderir,
// bu sunucu o servisten yalnızca üç true/false cevabını alır: {age_over_25, license_2y, class_ok}.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const PROVIDER = process.env.PROVIDER_URL || 'http://localhost:4000';
const CLIENT_ID = 'privacydrive';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'privacydrive-demo-secret';
const PUBLIC = path.join(__dirname, 'public');
const DB_FILE = path.join(__dirname, 'data', 'rental.json');
const VERIFIER = process.env.VERIFIER_URL || 'http://localhost:5000';

// ---- kiralama veritabanı (kasıtlı olarak çok basit) ----
let DB = { accounts: [], reservations: [] };
try { DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
const save = () => { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 1)); };
const uid = n => crypto.randomBytes(n).toString('hex');

// ---- güvenilen veri sağlayıcı açık anahtarı (30 sn önbellek) ----
let pubCache = { at: 0, v: null };
async function issuerPub() {
  if (pubCache.v && Date.now() - pubCache.at < 30000) return pubCache.v;
  const r = await fetch(PROVIDER + '/api/issuer/pubkey'); if (!r.ok) throw new Error('Sağlayıcıya ulaşılamadı');
  pubCache = { at: Date.now(), v: (await r.json()).pub }; return pubCache.v;
}

const vsessions = new Map(); // verifier oturumu -> hesap
const vh = { 'Content-Type': 'application/json' };

const ymd = s => Number(String(s).replace(/-/g, ''));
function ageOn(birthISO, onISO) {
  const b = new Date(birthISO + 'T00:00:00'), o = new Date(onISO + 'T00:00:00');
  let a = o.getFullYear() - b.getFullYear(); const m = o.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && o.getDate() < b.getDate())) a--; return a;
}
const isoOf = n => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };

// ---- http ----
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { no(new Error('geçersiz JSON')); } }); });
const account = id => DB.accounts.find(a => a.id === id);

const routes = {
  'GET /api/config': async (req, res) => json(res, 200, { providerUrl: PROVIDER, verifierUrl: VERIFIER, clientId: CLIENT_ID, issuerPub: await issuerPub() }),

  'POST /api/accounts': async (req, res) => {
    const { name, email, subject } = await body(req);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || !/^s_[0-9a-f]{12}$/.test(subject || '')) return json(res, 400, { error: 'Geçersiz hesap bilgisi' });
    let a = DB.accounts.find(x => x.veri_saglayici_ref === subject);
    if (!a) { a = { id: 'u_' + uid(3), ad_soyad: String(name).slice(0, 60), e_posta: String(email).slice(0, 80), veri_saglayici_ref: subject }; DB.accounts.push(a); save(); }
    json(res, 200, { account: a });
  },
  // Doğrulayıcıda oturum aç: cüzdan nonce ile kanıt üretip kanıtı DOĞRUDAN doğrulayıcıya gönderecek
  'POST /api/verify/start': async (req, res) => {
    const b = await body(req); const a = account(b.account_id);
    if (!a) return json(res, 404, { error: 'Hesap yok' });
    const r = await fetch(VERIFIER + '/api/sessions', { method: 'POST', headers: vh, body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, subject: a.veri_saglayici_ref, asOf: String(ymd(b.asOf)) }) });
    const d = await r.json(); if (!r.ok) return json(res, 502, { error: d.error || 'Doğrulayıcı reddetti' });
    vsessions.set(d.session_id, a.id);
    json(res, 200, { session_id: d.session_id, nonce: d.nonce });
  },
  // Doğrulayıcıdan yalnızca true/false cevabını al ve rezervasyon taslağını yaz
  'POST /api/verify/finish': async (req, res) => {
    const b = await body(req); const a = account(b.account_id);
    if (!a || vsessions.get(b.session_id) !== a.id) return json(res, 404, { error: 'Oturum yok' });
    const r = await fetch(`${VERIFIER}/api/sessions/${encodeURIComponent(b.session_id)}/result`, { headers: { 'X-Client-Id': CLIENT_ID, 'X-Client-Secret': CLIENT_SECRET } });
    const d = await r.json(); if (!r.ok) return json(res, 502, { error: d.error || 'Doğrulayıcı cevap vermedi' });
    if (d.status !== 'done') return json(res, 200, { result: { error: 'Doğrulayıcı henüz geçerli bir kanıt almadı' }, record: null });
    vsessions.delete(b.session_id);
    const claims = { age_over_25: d.age_over_25 === true, license_2y: d.license_2y === true, class_ok: d.class_ok === true };
    const eligible = claims.age_over_25 && claims.license_2y && claims.class_ok;
    const record = { id: 'rz_' + uid(3), demo_user_id: a.id, vehicle_id: b.vehicle_id ?? null, status: eligible ? 'taslak_onaylandi' : 'reddedildi', eligibility_result: eligible, ...claims };
    DB.reservations.push({ ...record, flow: 'zkp' }); save();
    json(res, 200, { result: { ...claims, eligible }, record });
  },

  // Klasik akış: kullanıcı KimlikKasası'nda onay verdi, kod bu SUNUCUYA gelir, gizli anahtarla tam kayıt alınır
  'POST /api/classic/finish': async (req, res) => {
    const b = await body(req); const a = account(b.account_id);
    if (!a) return json(res, 404, { error: 'Hesap yok' });
    const t0 = performance.now();
    const r = await fetch(PROVIDER + '/api/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: b.code }) });
    const d = await r.json(); if (!r.ok || d.mode !== 'classic') return json(res, 400, { error: d.error || 'Sağlayıcı reddetti' });
    if (d.subject !== a.veri_saglayici_ref) return json(res, 403, { error: 'KimlikKasası\'nda farklı bir kişi olarak giriş yaptınız; hesapla eşleşmiyor.' });
    const rec = d.record;
    const request = { ad_soyad: `${rec.ad} ${rec.soyad}`, e_posta: a.e_posta, dogum_tarihi: rec.dogum_tarihi, kimlik_no: rec.tc, ehliyet_sinifi: rec.ehliyet_sinifi, ehliyet_tarihi: rec.ehliyet_tarihi, hesap_id: a.id };
    const on = isoOf(ymd(b.asOf));
    const claims = {
      age_over_25: ageOn(rec.dogum_tarihi, on) >= 25,
      license_2y: !!rec.ehliyet_tarihi && ageOn(rec.ehliyet_tarihi, on) >= 2,
      class_ok: ['B', 'C'].includes(rec.ehliyet_sinifi)
    };
    const eligible = claims.age_over_25 && claims.license_2y && claims.class_ok;
    const record = { id: 'rz_' + uid(3), demo_user_id: a.id, vehicle_id: b.vehicle_id ?? null, status: eligible ? 'taslak_onaylandi' : 'reddedildi', eligibility_result: eligible, ...claims, ...request };
    DB.reservations.push({ ...record, flow: 'classic' }); save();   // demo politikası: klasik akış alanları saklar
    json(res, 200, { request, response: { eligible, ...claims }, record, ms: performance.now() - t0 });
  },

  // Demo için: kiralama sitesinin kendi veritabanında tam olarak ne olduğunu göster
  'GET /api/db-dump': (req, res) => json(res, 200, DB),

};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.zkey': 'application/octet-stream' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const h = routes[`${req.method} ${url.pathname}`];
    if (h) return await h(req, res);
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Bulunamadı' });
    let f = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { json(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`PrivacyDrive kiralama sitesi: http://localhost:${PORT}  (sağlayıcı: ${PROVIDER})`));
