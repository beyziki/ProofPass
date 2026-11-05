// PrivacyDrive ZK yardımcıları: kimlik kartı imzalama (veri sağlayıcı) ve çoklu iddia kanıtı (kullanıcı cüzdanı).
const { buildEddsa } = require('circomlibjs');
let E = null;
async function init() { if (!E) E = await buildEddsa(); return true; }
const F = () => E.F;
const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));

// 's_1a2b3c4d' gibi bir referansı alan elemanına çevirir (48 bitin altında, alan sınırına takılmaz)
function subjectToField(subject) { return BigInt('0x' + subject.replace(/^s_/, '')); }

// Veri sağlayıcı: rastgele imza anahtarı üretir; açık anahtar (Ax, Ay) herkese açıktır.
function newIssuerKey() {
  const prv = crypto.getRandomValues(new Uint8Array(32));
  return { prvHex: hex(prv), pub: pubFromPrv(hex(prv)) };
}
function pubFromPrv(prvHex) {
  const pub = E.prv2pub(Buffer.from(unhex(prvHex)));
  return { Ax: F().toObject(pub[0]).toString(), Ay: F().toObject(pub[1]).toString() };
}
// Ehliyet sınıfı → rütbe (devre içinde rütbe >= 2 "binek araç için yeterli" sayılır)
const CLASS_RANK = { A2: 1, B: 2, C: 3 };
const classRank = c => (c ? (CLASS_RANK[c] || 0) : 0);
// Veri sağlayıcı: Poseidon(doğum, ehliyet tarihi, sınıf rütbesi, subject) mesajını EdDSA ile imzalar → kimlik kartı
// licDate 0 ise ehliyet yok demektir.
function issueCredential(prvHex, birthYYYYMMDD, licDateYYYYMMDD, licClass, subject) {
  const rank = classRank(licClass), lic = licDateYYYYMMDD ? BigInt(licDateYYYYMMDD) : 0n;
  const msg = E.poseidon([BigInt(birthYYYYMMDD), lic, BigInt(rank), subjectToField(subject)]);
  const sig = E.signPoseidon(Buffer.from(unhex(prvHex)), msg);
  return {
    birth: String(birthYYYYMMDD), licDate: lic.toString(), classRank: String(rank), subject,
    R8x: F().toObject(sig.R8[0]).toString(), R8y: F().toObject(sig.R8[1]).toString(), S: sig.S.toString()
  };
}
// Kullanıcı cüzdanı: kimlik kartından; doğum tarihi, ehliyet tarihi ve sınıfı açıklanmadan üç iddia için tek kanıt üretir.
async function proveClaims(snarkjs, wasm, zkey, cred, issuerPub, asOfYYYYMMDD, nonceHex) {
  const input = {
    issuerAx: issuerPub.Ax, issuerAy: issuerPub.Ay, asOf: String(asOfYYYYMMDD),
    subject: subjectToField(cred.subject).toString(), nonce: BigInt('0x' + nonceHex).toString(),
    birth: cred.birth, licDate: cred.licDate, classRank: cred.classRank,
    sigR8x: cred.R8x, sigR8y: cred.R8y, sigS: cred.S
  };
  return snarkjs.groth16.fullProve(input, { type: 'mem', data: wasm }, { type: 'mem', data: zkey });
}
async function verifyProof(snarkjs, vkey, proof, publicSignals) { return snarkjs.groth16.verify(vkey, publicSignals, proof); }
module.exports = { init, newIssuerKey, pubFromPrv, issueCredential, proveClaims, verifyProof, subjectToField, classRank };
