# ProofPass: üç ayrı servis

Tüm veriler SENTETİKTİR. Gereksinim: Node.js 22.13+. Siteleri `localhost` ile aç.

| Servis | Klasör | Port | Görevi |
|---|---|---|---|
| KimlikKasası | provider | 4000 | Veri sağlayıcı (SQLite, 300 sentetik kişi, onay ekranı) |
| PrivacyDrive | rental | 3000 | Kiralama sitesi |
| Doğrulayıcı | verifier | 5000 | ZKP kanıtını doğrular, kiralamaya yalnızca true/false söyler |

## Kurulum (üç ayrı terminal)

    cd provider  &&  npm install  &&  npm run seed  &&  npm start
    cd verifier  &&  npm install  &&  npm start
    cd rental    &&  npm start

Tarayıcı: http://localhost:3000

## Akış (ZKP)
1. Kiralama sunucusu doğrulayıcıda oturum açar (gizli anahtarla) ve nonce alır.
2. Tarayıcıdaki cüzdan kanıtı üretir ve DOĞRUDAN doğrulayıcıya gönderir. Kiralama sunucusu kanıtı görmez.
3. Kiralama sunucusu doğrulayıcıdan yalnızca üç true/false cevabı alır: {age_over_25, license_2y, class_ok}.

Tek kanıtta üç iddia (Circom devresi `rental/drive_proof.circom`, Groth16):
- age_over_25: yaş >= 25 (doğum tarihi açıklanmaz)
- license_2y: ehliyet en az 2 yıllık (ehliyet tarihi açıklanmaz; ehliyet yoksa false)
- class_ok: ehliyet sınıfı B veya üzeri (sınıf açıklanmaz; A2 yetmez)

## Demo kişileri (KimlikKasası'ndaki ilk 6 kişi, şifre: demo123)
1. Nehir Öztürk: hepsi tamam → uygun
2. Esra Özdemir: 23 yaş → yaş yetmez
3. Elif Özdemir: ehliyet 2026-02 → 2 yıldan yeni
4. Dilara Kılıç: A2 (motosiklet) → sınıf yetmez
5. Merve Erdem: ehliyeti yok → ehliyet ve sınıf yetmez
6. Emre Kara: C sınıfı, 2019 → uygun
(T.C. numaraları KimlikKasası giriş ekranındaki listede görünür.)

## Güncelleme sonrası
Kimlik kartı biçimi ve kurulum anahtarları değiştiyse: `provider/data` silinip `npm run seed` yeniden çalıştırılmalı,
`rental/data` silinmeli, tarayıcıda hesap yeniden oluşturulmalıdır.
