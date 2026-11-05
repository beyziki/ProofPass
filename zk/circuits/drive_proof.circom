pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";

// PrivacyDrive: tek kanıtta üç iddia.
//   age_over_25  : yaş >= 25
//   license_2y   : ehliyet en az 2 yıllık (ehliyet yoksa 0)
//   class_ok     : ehliyet sınıfı binek araç için yeterli (rütbe >= 2: B ve üzeri)
// Özel girdiler: doğum tarihi, ehliyet tarihi, sınıf rütbesi ve veri sağlayıcının bunları içeren imzası.
// Açık girdiler: veri sağlayıcının açık anahtarı, alış tarihi, hesap referansı (subject), nonce.
// Açık çıktılar yalnızca üç bittir; hiçbir tarih veya sınıf açık sinyallerde bulunmaz.
template DriveProof(minAge, minLicenseYears, minClassRank) {
    signal input issuerAx;
    signal input issuerAy;
    signal input asOf;
    signal input subject;
    signal input nonce;

    signal input birth;
    signal input licDate;     // YYYYMMDD, 0 = ehliyet yok
    signal input classRank;   // 0 = yok, 1 = A2, 2 = B, 3 = C
    signal input sigR8x;
    signal input sigR8y;
    signal input sigS;

    signal output age_over_25;
    signal output license_2y;
    signal output class_ok;

    // İmzalı kimlik kartı: M = Poseidon(birth, licDate, classRank, subject)
    component h = Poseidon(4);
    h.inputs[0] <== birth;
    h.inputs[1] <== licDate;
    h.inputs[2] <== classRank;
    h.inputs[3] <== subject;

    component v = EdDSAPoseidonVerifier();
    v.enabled <== 1;
    v.Ax <== issuerAx;
    v.Ay <== issuerAy;
    v.S <== sigS;
    v.R8x <== sigR8x;
    v.R8y <== sigR8y;
    v.M <== h.out;

    // 1) yaş: doğum <= alış - 25*10000
    component le = LessEqThan(32);
    le.in[0] <== birth;
    le.in[1] <== asOf - minAge * 10000;
    age_over_25 <== le.out;

    // 2) ehliyet süresi: ehliyet var (licDate != 0) VE licDate <= alış - 2*10000
    component lic = LessEqThan(32);
    lic.in[0] <== licDate;
    lic.in[1] <== asOf - minLicenseYears * 10000;
    component noLic = IsZero();
    noLic.in <== licDate;
    license_2y <== lic.out * (1 - noLic.out);

    // 3) sınıf yeterliliği: rütbe >= 2
    component cls = GreaterEqThan(8);
    cls.in[0] <== classRank;
    cls.in[1] <== minClassRank;
    class_ok <== cls.out;

    // nonce'un kanıta bağlanması
    signal nonceSq;
    nonceSq <== nonce * nonce;
}

component main {public [issuerAx, issuerAy, asOf, subject, nonce]} = DriveProof(25, 2, 2);
