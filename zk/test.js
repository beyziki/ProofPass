const fs=require('fs');const snarkjs=require('snarkjs');const Z=require('./src/lib.js');
const wasm=fs.readFileSync('build/drive_proof_js/drive_proof.wasm'),zkey=fs.readFileSync('build/drive_final.zkey'),vkey=JSON.parse(fs.readFileSync('build/vkey.json'));
const ymd=(y,m,d)=>y*10000+m*100+d;
(async()=>{
 await Z.init();const k=Z.newIssuerKey();const subj='s_1a2b3c4d';const nonce='deadbeefcafe0001';const asOf=ymd(2026,10,31);
 let fail=0;
 async function run(label,birth,lic,cls,exp,opts={}){
   const cred=Z.issueCredential(k.prvHex,birth,lic,cls,subj);
   const {proof,publicSignals}=await Z.proveClaims(snarkjs,wasm,zkey,cred,k.pub,asOf,nonce);
   let ps=[...publicSignals];
   if(opts.tamper!==undefined) ps[opts.tamper]=ps[opts.tamper]==='1'?'0':'1';
   const ok=await Z.verifyProof(snarkjs,vkey,proof,ps);
   const got=publicSignals.slice(0,3).join('');
   const leak=ps.some(x=>[String(birth),...(lic?[String(lic)]:[])].includes(x));
   const pass=opts.tamper!==undefined? ok===false : (got===exp&&ok&&!leak);
   if(!pass)fail++;
   console.log(pass?'OK  ':'FAIL',label.padEnd(36),'[yaş,ehl2y,sınıf]=',got,'verify=',ok,'sızıntı=',leak);
 }
 await run('27y, 5y B ehliyet',ymd(1999,5,5),ymd(2021,3,1),'B','111');
 await run('24y, 5y B',ymd(2002,5,5),ymd(2021,3,1),'B','011');
 await run('27y, 1y B (2y dolmadı)',ymd(1999,5,5),ymd(2025,11,1),'B','101');
 await run('tam 2 yıl (2024-10-31)',ymd(1999,5,5),ymd(2024,10,31),'B','111');
 await run('2 yıla 1 gün (2024-11-01)',ymd(1999,5,5),ymd(2024,11,1),'B','101');
 await run('27y, A2 (motosiklet)',ymd(1999,5,5),ymd(2015,3,1),'A2','110');
 await run('27y, C sınıfı',ymd(1999,5,5),ymd(2015,3,1),'C','111');
 await run('27y, ehliyet yok',ymd(1999,5,5),0,null,'100');
 await run('sonuç biti oynandı (ehliyet)',ymd(1999,5,5),ymd(2025,11,1),'B','',{tamper:1});
 await run('sonuç biti oynandı (sınıf)',ymd(1999,5,5),ymd(2015,3,1),'A2','',{tamper:2});
 const k2=Z.newIssuerKey();const fake=Z.issueCredential(k2.prvHex,ymd(1990,1,1),ymd(2000,1,1),'C',subj);
 try{await Z.proveClaims(snarkjs,wasm,zkey,fake,k.pub,asOf,nonce);console.log('FAIL sahte imza kabul');fail++}catch(e){console.log('OK   sahte imza: proof üretilemedi')}
 // imzalı kartta sınıf yükseltme: A2 kartını C'ymiş gibi sun
 const c=Z.issueCredential(k.prvHex,ymd(1999,5,5),ymd(2015,3,1),'A2',subj);c.classRank='3';
 try{await Z.proveClaims(snarkjs,wasm,zkey,c,k.pub,asOf,nonce);console.log('FAIL sınıf değişikliği kabul');fail++}catch(e){console.log('OK   imzalı sınıf değiştirilemez')}
 const d=Z.issueCredential(k.prvHex,ymd(1999,5,5),ymd(2025,11,1),'B',subj);d.licDate=String(ymd(2015,1,1));
 try{await Z.proveClaims(snarkjs,wasm,zkey,d,k.pub,asOf,nonce);console.log('FAIL ehliyet tarihi değişikliği kabul');fail++}catch(e){console.log('OK   imzalı ehliyet tarihi değiştirilemez')}
 console.log(fail?'HATA '+fail:'TÜM TESTLER GEÇTİ');process.exit(fail?1:0);
})();
