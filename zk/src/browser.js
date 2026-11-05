const {Buffer}=require('buffer');globalThis.Buffer=Buffer;globalThis.global=globalThis;
if(!globalThis.process)globalThis.process={env:{},browser:true,nextTick:(f,...a)=>Promise.resolve().then(()=>f(...a)),version:'',versions:{}};
const lib=require('./lib.js');
const snarkjs=require('snarkjs');
const {buildBn128}=require('ffjavascript');
// Tek iş parçacıklı eğri: sandbox içinde Worker gerekmeden kanıt üretir
lib.useSingleThread=async()=>{if(!globalThis.curve_bn128)globalThis.curve_bn128=await buildBn128(true)};
lib.snarkjs=snarkjs;
globalThis.PDZK=lib;
