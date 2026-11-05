// KimlikKasası — e-Devlet benzeri SENTETİK veri sağlayıcı (backend). Port: 4000
// Kiralama sitesi bu veritabanına DOĞRUDAN erişemez; yalnızca aşağıdaki API'yi, kullanıcının onayıyla kullanabilir.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { buildEddsa } = require('circomlibjs');

const PORT = Number(process.env.PORT) || 4000;
const DB_PATH = path.join(__dirname, 'data', 'provider.db');
const KEY_PATH = path.join(__dirname, 'data', 'issuer.key.json');
const PUBLIC = path.join(__dirname, 'public');

if (!fs.existsSync(DB_PATH)) { console.error('Veritabanı yok. Önce: npm run seed'); process.exit(1); }
const db = new DatabaseSync(DB_PATH);

// Güvenilir taraflar (relying party) kaydı — gerçek e-Devlet'teki "kurum kaydı" gibi
const CLIENTS = {
  privacydrive: {
    name: 'PrivacyDrive Araç Kiralama',
    secret: 'privacydrive-demo-secret',            // yalnızca kiralama sitesinin SUNUCUSU bilir
    origins: ['http://localhost:3000'],
    redirects: ['http://localhost:3000/'],
  }
};

// ---- Veri sağlayıcının imza anahtarı (EdDSA / BabyJubJub) ----
const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
let E, KEY;
async function initKey() {
  E = await buildEddsa();
  if (fs.existsSync(KEY_PATH)) KEY = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  else {
    KEY = { prv: hex(crypto.randomBytes(32)), subjectSecret: hex(crypto.randomBytes(32)) };
    fs.writeFileSync(KEY_PATH, JSON.stringify(KEY));
  }
  const pub = E.prv2pub(Buffer.from(unhex(KEY.prv)));
  KEY.pub = { Ax: E.F.toObject(pub[0]).toString(), Ay: E.F.toObject(pub[1]).toString() };
}
const subjectFor = (citizenId, audience) =>
  's_' + crypto.createHmac('sha256', KEY.subjectSecret).update(citizenId + '|' + audience).digest('hex').slice(0, 12);
const CLASS_RANK = { A2: 1, B: 2, C: 3 };   // devre içinde rütbe >= 2 "binek araç için yeterli" sayılır
// İmzalanan mesaj: Poseidon(doğum, ehliyet tarihi (0 = yok), sınıf rütbesi, subject)
function issueCredential(birthYYYYMMDD, licDateYYYYMMDD, licClass, subject) {
  const rank = licClass ? (CLASS_RANK[licClass] || 0) : 0, lic = licDateYYYYMMDD ? BigInt(licDateYYYYMMDD) : 0n;
  const msg = E.poseidon([BigInt(birthYYYYMMDD), lic, BigInt(rank), BigInt('0x' + subject.replace(/^s_/, ''))]);
  const sig = E.signPoseidon(Buffer.from(unhex(KEY.prv)), msg);
  return { birth: String(birthYYYYMMDD), licDate: lic.toString(), classRank: String(rank), subject,
    R8x: E.F.toObject(sig.R8[0]).toString(), R8y: E.F.toObject(sig.R8[1]).toString(), S: sig.S.toString() };
}

// ---- yardımcılar ----
const sessions = new Map(); // token -> {citizenId, exp}
const attempts = new Map(); // ip -> [ts]
const regAttempts = new Map();
const iso = d => d.toISOString().slice(0, 10);
const ILLER = { 'Kayseri': ['Melikgazi'], 'Ankara': ['Çankaya'], 'İstanbul': ['Kadıköy'], 'İzmir': ['Karşıyaka'], 'Bursa': ['Nilüfer'], 'Konya': ['Selçuklu'] };
const now = () => Date.now();
const log = (citizenId, audience, kind, detail) =>
  db.prepare('INSERT INTO access_log (citizen_id,ts,audience,kind,detail) VALUES (?,?,?,?,?)')
    .run(citizenId, new Date().toISOString(), audience, kind, detail || '');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32, { N: 1024, r: 8, p: 1 }).toString('hex');
const parseCookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a[0]));
function sessionOf(req) {
  const t = parseCookies(req).kk_session; const s = t && sessions.get(t);
  if (!s || s.exp < now()) return null; return s;
}
const FIELDS_PRIVATE = `id,tc,ad,soyad,cinsiyet,anne_adi,baba_adi,dogum_tarihi,dogum_yeri,medeni_hal,il,ilce,adres,telefon,eposta,ehliyet_sinifi,ehliyet_tarihi,vergi_no,sgk_no,egitim,meslek,arac_plaka`;
const ymd = s => Number(s.replace(/-/g, ''));
const ymdOrZero = s => (s ? ymd(s) : 0);

function send(res, code, body, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, no) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { no(new Error('geçersiz JSON')); } });
  });
}
function cors(req) {
  const o = req.headers.origin;
  const allowed = Object.values(CLIENTS).some(c => c.origins.includes(o));
  return allowed ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Vary': 'Origin' } : {};
}

// ---- yönlendirici ----
const routes = {
  'GET /api/health': (req, res) => send(res, 200, { ok: true, vatandas: db.prepare('SELECT COUNT(*) n FROM citizens').get().n }),

  // Herkese açık: kiralama sitesi bu anahtarla imzaları doğrular
  'GET /api/issuer/pubkey': (req, res) => send(res, 200, { issuer: 'KimlikKasası', pub: KEY.pub }, cors(req)),

  // YALNIZCA DEMO: giriş ekranında denenebilecek uydurma kişiler
  'GET /api/demo-users': (req, res) => send(res, 200, db.prepare('SELECT tc,ad,soyad FROM citizens ORDER BY id LIMIT 6').all()),

  'POST /api/login': async (req, res) => {
    const ip = req.socket.remoteAddress;
    const a = (attempts.get(ip) || []).filter(t => t > now() - 60000);
    if (a.length >= 8) return send(res, 429, { error: 'Çok fazla deneme. Bir dakika bekleyin.' });
    const { tc, password } = await readBody(req);
    attempts.set(ip, [...a, now()]);
    const u = db.prepare('SELECT id,pw_salt,pw_hash FROM citizens WHERE tc=?').get(String(tc || ''));
    const okPw = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(password || ''), u.pw_salt), 'hex'), Buffer.from(u.pw_hash, 'hex'));
    if (!okPw) return send(res, 401, { error: 'T.C. kimlik no veya şifre hatalı.' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { citizenId: u.id, exp: now() + 30 * 60000 });
    log(u.id, 'KimlikKasası', 'giris', 'Kullanıcı kendi hesabına giriş yaptı');
    send(res, 200, { ok: true }, { 'Set-Cookie': `kk_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800` });
  },
  // Demo kayıt: T.C. kimlik no SUNUCUDA, sentetik olarak üretilir (9 ile başlar). Gerçek kimlik numarası alınmaz.
  'POST /api/register': async (req, res) => {
    const ip = req.socket.remoteAddress;
    const a = (regAttempts.get(ip) || []).filter(t => t > now() - 60000);
    if (a.length >= 5) return send(res, 429, { error: 'Dakikada en fazla 5 kayıt oluşturulabilir. Biraz bekleyin.' });
    const b = await readBody(req);
    const bad = m => send(res, 400, { error: m });
    const nameOk = x => typeof x === 'string' && /^[A-Za-zÇĞİÖŞÜçğıöşü' -]{2,30}$/.test(x.trim());
    if (!nameOk(b.ad) || !nameOk(b.soyad)) return bad('Ad ve soyad 2-30 harf olmalı.');
    const dg = String(b.dogum_tarihi || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dg) || isNaN(new Date(dg)) || dg < '1920-01-01' || dg > iso(new Date(Date.now() - 16 * 365.25 * 864e5))) return bad('Geçerli bir doğum tarihi girin (en az 16 yaşında).');
    if (!ILLER[b.il]) return bad('Listeden bir il seçin.');
    let sinif = b.ehliyet_sinifi || null, etar = b.ehliyet_tarihi || null;
    if (sinif && !['A2', 'B', 'C'].includes(sinif)) return bad('Geçersiz ehliyet sınıfı.');
    if (!sinif) etar = null;
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(etar)) || isNaN(new Date(etar))) return bad('Ehliyet alım tarihini girin.');
      const min = new Date(dg + 'T00:00:00'); min.setFullYear(min.getFullYear() + 18);
      if (etar < iso(min)) return bad('Ehliyet, 18 yaşından önce alınmış olamaz.');
      if (etar > iso(new Date())) return bad('Ehliyet alım tarihi gelecekte olamaz.');
    }
    const pw = String(b.password || '');
    if (pw.length < 6 || pw.length > 64) return bad('Şifre 6-64 karakter olmalı.');
    if (db.prepare('SELECT COUNT(*) n FROM citizens').get().n >= 3000) return bad('Demo kayıt sınırına ulaşıldı.');
    let tc; do { tc = '9' + String(crypto.randomInt(0, 1e10)).padStart(10, '0'); } while (db.prepare('SELECT 1 FROM citizens WHERE tc=?').get(tc));
    const ad = b.ad.trim(), soyad = b.soyad.trim(), ilce = ILLER[b.il][0];
    const slug = x => x.toLowerCase().replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/i̇/g, 'i').replace(/[^a-z]/g, '');
    const digits = n => Array.from(crypto.randomBytes(n), x => x % 10).join('');
    const salt = crypto.randomBytes(8).toString('hex');
    const r = db.prepare(`INSERT INTO citizens (tc,pw_salt,pw_hash,ad,soyad,cinsiyet,anne_adi,baba_adi,dogum_tarihi,dogum_yeri,medeni_hal,il,ilce,adres,telefon,eposta,ehliyet_sinifi,ehliyet_tarihi,vergi_no,sgk_no,egitim,meslek,arac_plaka)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tc, salt, hashPw(pw, salt), ad, soyad, null, null, null, dg, b.il, null,
      b.il, ilce, `Demo Sk. No:1 ${ilce}/${b.il}`, `0530 ${digits(3)} ${digits(2)} ${digits(2)}`, `${slug(ad)}.${slug(soyad)}@ornek-eposta.test`,
      sinif, etar, digits(10), digits(11), null, null, null);
    log(Number(r.lastInsertRowid), 'KimlikKasası', 'kayit', 'Demo hesap oluşturuldu (sentetik T.C. kimlik no atandı)');
    regAttempts.set(ip, [...a, now()]);   // yalnızca BAŞARILI kayıtlar sayılır (dakikada 5)
    send(res, 200, { ok: true, tc });
  },
  'POST /api/logout': (req, res) => {
    const t = parseCookies(req).kk_session; sessions.delete(t);
    send(res, 200, { ok: true }, { 'Set-Cookie': 'kk_session=; HttpOnly; Path=/; Max-Age=0' });
  },

  // Giriş yapan kullanıcı YALNIZCA kendi kaydını görür
  'GET /api/me': (req, res) => {
    const s = sessionOf(req); if (!s) return send(res, 401, { error: 'Giriş gerekli' });
    send(res, 200, db.prepare(`SELECT ${FIELDS_PRIVATE} FROM citizens WHERE id=?`).get(s.citizenId));
  },
  'GET /api/me/access-log': (req, res) => {
    const s = sessionOf(req); if (!s) return send(res, 401, { error: 'Giriş gerekli' });
    send(res, 200, db.prepare('SELECT ts,audience,kind,detail FROM access_log WHERE citizen_id=? ORDER BY id DESC LIMIT 100').all(s.citizenId));
  },

  // Kurum bilgisi (onay ekranı için)
  'GET /api/oauth/client': (req, res, url) => {
    const c = CLIENTS[url.searchParams.get('client_id')];
    if (!c) return send(res, 404, { error: 'Tanımsız kurum' });
    send(res, 200, { name: c.name, redirect_ok: c.redirects.includes(url.searchParams.get('redirect_uri')) });
  },
  // Kullanıcı onay verir → tek kullanımlık, 2 dk geçerli kod
  'POST /api/oauth/authorize': async (req, res) => {
    const s = sessionOf(req); if (!s) return send(res, 401, { error: 'Giriş gerekli' });
    const { client_id, redirect_uri, mode } = await readBody(req);
    const c = CLIENTS[client_id];
    if (!c || !c.redirects.includes(redirect_uri)) return send(res, 400, { error: 'Geçersiz kurum veya yönlendirme adresi' });
    if (!['zk', 'classic'].includes(mode)) return send(res, 400, { error: 'Geçersiz mod' });
    const code = crypto.randomBytes(20).toString('hex');
    db.prepare('INSERT INTO auth_codes (code,citizen_id,audience,mode,exp) VALUES (?,?,?,?,?)').run(code, s.citizenId, client_id, mode, now() + 120000);
    log(s.citizenId, c.name, 'onay', mode === 'zk' ? 'Yaş kimlik kartı verilmesine onay (doğum tarihi paylaşılmaz)' : 'Klasik paylaşım onayı (ad, T.C. no, doğum tarihi)');
    send(res, 200, { redirect: `${redirect_uri}?code=${code}` });
  },
  // Kod → veri. zk modu: imzalı kimlik kartı (tarayıcıdaki cüzdan alır). classic modu: kurum sunucusu, gizli anahtarla alır.
  'POST /api/oauth/token': async (req, res) => {
    const { client_id, client_secret, code } = await readBody(req);
    const c = CLIENTS[client_id]; if (!c) return send(res, 400, { error: 'Geçersiz kurum' }, cors(req));
    const row = db.prepare('SELECT * FROM auth_codes WHERE code=?').get(String(code || ''));
    if (!row || row.used || row.exp < now() || row.audience !== client_id) return send(res, 400, { error: 'Kod geçersiz veya süresi dolmuş' }, cors(req));
    const secretOk = client_secret && client_secret === c.secret;
    const originOk = c.origins.includes(req.headers.origin);
    if (row.mode === 'classic' && !secretOk) return send(res, 403, { error: 'Klasik paylaşım yalnızca kurum sunucusuna verilir' }, cors(req));
    if (row.mode === 'zk' && !secretOk && !originOk) return send(res, 403, { error: 'İzin verilmeyen köken' }, cors(req));
    db.prepare('UPDATE auth_codes SET used=1 WHERE code=?').run(code);
    const p = db.prepare('SELECT * FROM citizens WHERE id=?').get(row.citizen_id);
    if (row.mode === 'classic') {
      log(p.id, c.name, 'veri-paylasimi', 'Ad, T.C. kimlik no, doğum tarihi, ehliyet sınıfı ve ehliyet tarihi kurum sunucusuna verildi');
      return send(res, 200, { mode: 'classic', subject: subjectFor(p.id, client_id), record: { ad: p.ad, soyad: p.soyad, tc: p.tc, dogum_tarihi: p.dogum_tarihi, ehliyet_sinifi: p.ehliyet_sinifi, ehliyet_tarihi: p.ehliyet_tarihi } }, cors(req));
    }
    const subject = subjectFor(p.id, client_id);   // kurum başına farklı takma ad
    log(p.id, c.name, 'kimlik-karti', 'İmzalı kimlik kartı (doğum tarihi, ehliyet tarihi ve sınıfı) kullanıcının cüzdanına verildi; kuruma gösterilmez');
    send(res, 200, { mode: 'zk', subject, credential: issueCredential(ymd(p.dogum_tarihi), ymdOrZero(p.ehliyet_tarihi), p.ehliyet_sinifi, subject), issuer: KEY.pub }, cors(req));
  },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
    const h = routes[`${req.method} ${url.pathname}`];
    if (h) return await h(req, res, url);
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Bulunamadı' });
    // statik frontend
    let f = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC, 'index.html');
    if (!fs.existsSync(f)) return send(res, 404, { error: 'Frontend henüz yok (Adım 2)' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 500, { error: e.message }); }
});
initKey().then(() => server.listen(PORT, () => console.log(`KimlikKasası sağlayıcı: http://localhost:${PORT}  (SENTETİK veri)`)));
