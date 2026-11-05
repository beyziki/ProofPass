// Sentetik vatandaş veritabanı üretir. Tüm kişiler, numaralar ve adresler UYDURMADIR.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'data', 'provider.db');
const COUNT = Number(process.argv[2]) || 300;
const DEMO_PASSWORD = 'demo123';

// deterministik rastgele (her seed aynı veriyi üretsin)
let s = 20261028;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const digits = n => Array.from({ length: n }, () => int(0, 9)).join('');

const ERKEK = ['Ahmet','Mehmet','Mustafa','Ali','Hasan','Emre','Burak','Can','Kerem','Onur','Eren','Yusuf','Murat','Serkan','Tolga','Barış','Cem','Deniz','Kaan','Berk'];
const KADIN = ['Ayşe','Fatma','Zeynep','Elif','Merve','Selin','Buse','Esra','Derya','Ceren','Gizem','Pınar','Ece','Sena','Dilara','Hande','Nehir','İrem','Melis','Defne'];
const SOYAD = ['Yılmaz','Kaya','Demir','Şahin','Çelik','Yıldız','Yıldırım','Öztürk','Aydın','Özdemir','Arslan','Doğan','Kılıç','Aslan','Çetin','Kara','Koç','Kurt','Özkan','Şimşek','Polat','Erdem','Güneş','Acar','Tekin'];
const ILLER = {
  'Kayseri': ['Melikgazi','Kocasinan','Talas','Develi'],
  'Ankara': ['Çankaya','Keçiören','Yenimahalle','Mamak'],
  'İstanbul': ['Kadıköy','Beşiktaş','Üsküdar','Esenyurt'],
  'İzmir': ['Karşıyaka','Bornova','Konak','Buca'],
  'Bursa': ['Nilüfer','Osmangazi','Yıldırım'],
  'Konya': ['Selçuklu','Meram','Karatay']
};
const PLAKA = { 'Kayseri': 38, 'Ankara': 6, 'İstanbul': 34, 'İzmir': 35, 'Bursa': 16, 'Konya': 42 };
const MESLEK = ['Öğrenci','Mühendis','Öğretmen','Hemşire','Muhasebeci','Esnaf','Serbest meslek','Memur','Teknisyen','Avukat'];
const EGITIM = ['İlkokul','Ortaokul','Lise','Ön lisans','Lisans','Yüksek lisans'];
const SOKAK = ['Gül','Menekşe','Atatürk','Cumhuriyet','İnönü','Fidan','Çınar','Barış','Lale','Papatya'];

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE citizens (
  id INTEGER PRIMARY KEY, tc TEXT UNIQUE NOT NULL, pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL,
  ad TEXT, soyad TEXT, cinsiyet TEXT, anne_adi TEXT, baba_adi TEXT,
  dogum_tarihi TEXT, dogum_yeri TEXT, medeni_hal TEXT,
  il TEXT, ilce TEXT, adres TEXT, telefon TEXT, eposta TEXT,
  ehliyet_sinifi TEXT, ehliyet_tarihi TEXT, vergi_no TEXT, sgk_no TEXT,
  egitim TEXT, meslek TEXT, arac_plaka TEXT
);
CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, citizen_id INTEGER NOT NULL, ts TEXT NOT NULL,
  audience TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT
);
CREATE TABLE auth_codes (
  code TEXT PRIMARY KEY, citizen_id INTEGER NOT NULL, audience TEXT NOT NULL, mode TEXT NOT NULL,
  exp INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
`);

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32, { N: 1024, r: 8, p: 1 }).toString('hex');
const ins = db.prepare(`INSERT INTO citizens (tc,pw_salt,pw_hash,ad,soyad,cinsiyet,anne_adi,baba_adi,dogum_tarihi,dogum_yeri,medeni_hal,il,ilce,adres,telefon,eposta,ehliyet_sinifi,ehliyet_tarihi,vergi_no,sgk_no,egitim,meslek,arac_plaka)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const today = new Date('2026-10-28');
const iso = d => d.toISOString().slice(0, 10);
const used = new Set();
// İlk 6 kişi demo senaryoları: her biri farklı bir koşulda başarılı/başarısız olur
//  1 hepsi tamam · 2 yaş yetmez · 3 ehliyet 2 yıldan yeni · 4 sınıf yetmez (A2) · 5 ehliyet yok · 6 C sınıfı, hepsi tamam
const SCEN = [
  { yas: 31, sinif: 'B',  ehlYil: 2014 },
  { yas: 23, sinif: 'B',  ehlYil: 2021 },
  { yas: 28, sinif: 'B',  ehlTarih: '2026-02-14' },
  { yas: 35, sinif: 'A2', ehlYil: 2012 },
  { yas: 40, sinif: null },
  { yas: 26, sinif: 'C',  ehlYil: 2019 },
];
db.exec('BEGIN');
for (let i = 0; i < COUNT; i++) {
  const kadin = rnd() < 0.5;
  const ad = pick(kadin ? KADIN : ERKEK), soyad = pick(SOYAD);
  // 17–62 yaş arası; 25 sınırı civarında yoğunluk olsun diye bir kısmı 23–27
  let yas = rnd() < 0.35 ? int(23, 27) : int(17, 62);
  if (SCEN[i]) yas = SCEN[i].yas;
  const dg = new Date(today); dg.setFullYear(today.getFullYear() - yas); dg.setDate(dg.getDate() - int(0, 364));
  let tc; do { tc = String(int(1, 9)) + digits(10); } while (used.has(tc)); used.add(tc);
  const il = pick(Object.keys(ILLER)), ilce = pick(ILLER[il]);
  let ehl = yas >= 18 ? pick(['B','B','B','A2','C']) : null;
  let ehlTarih = ehl ? iso(new Date(dg.getTime() + (18 + int(0, Math.max(0, yas - 18))) * 365.25 * 864e5)) : null;
  if (SCEN[i]) { const c = SCEN[i]; ehl = c.sinif; ehlTarih = !c.sinif ? null : (c.ehlTarih || `${c.ehlYil}-0${int(1, 9)}-1${int(0, 9)}`); }
  const salt = crypto.randomBytes(8).toString('hex');
  ins.run(tc, salt, hashPw(DEMO_PASSWORD, salt), ad, soyad, kadin ? 'Kadın' : 'Erkek',
    pick(KADIN), pick(ERKEK), iso(dg), pick(Object.keys(ILLER)),
    yas < 22 ? 'Bekar' : pick(['Bekar','Evli','Bekar']),
    il, ilce, `${pick(SOKAK)} Sk. No:${int(1, 80)} D:${int(1, 12)} ${ilce}/${il}`,
    `05${int(30, 59)} ${digits(3)} ${digits(2)} ${digits(2)}`,
    `${ad}.${soyad}${int(1, 99)}@ornek-eposta.test`.toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/İ/g,'i'),
    ehl, ehlTarih, digits(10), digits(11),
    yas < 18 ? 'Ortaokul' : pick(EGITIM), yas < 22 ? 'Öğrenci' : pick(MESLEK),
    rnd() < 0.5 ? `${PLAKA[il]} ${pick(['ABC','KLM','TRK','ZYX'])} ${int(10, 999)}` : null);
}
db.exec('COMMIT');
console.log(`${COUNT} sentetik vatandaş üretildi → ${DB_PATH}`);
console.log('Demo giriş: herkesin e-Devlet şifresi =', DEMO_PASSWORD);
console.log('Örnek giriş yapılabilecek ilk 5 kişi:');
for (const r of db.prepare('SELECT tc, ad, soyad, dogum_tarihi, ehliyet_sinifi, ehliyet_tarihi FROM citizens ORDER BY id LIMIT 6').all()) console.log(' ', r.tc, r.ad, r.soyad, r.dogum_tarihi, r.ehliyet_sinifi || '-', r.ehliyet_tarihi || '-');
