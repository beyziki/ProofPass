#!/usr/bin/env bash
# Rebuilds everything the apps need: circuit -> r1cs/wasm -> (demo) trusted setup -> zkey/vkey -> browser bundle.
# Requires: circom 2.1.9 on PATH, Node.js, and `npm install` run in this folder.
set -euo pipefail
cd "$(dirname "$0")"
SNARKJS="node $PWD/node_modules/snarkjs/build/cli.cjs"
mkdir -p build && cd build

# 1) compile the circuit
circom ../circuits/drive_proof.circom --r1cs --wasm --sym -l ../node_modules -o .

# 2) powers of tau (2^13 is enough for ~4.6k constraints). DEMO ceremony: one contributor, local entropy.
if [ ! -f pot_final.ptau ]; then
  $SNARKJS powersoftau new bn128 13 pot_0.ptau
  echo "demo-entropy-$(date +%s)-$RANDOM" | $SNARKJS powersoftau contribute pot_0.ptau pot_1.ptau --name="demo"
  $SNARKJS powersoftau prepare phase2 pot_1.ptau pot_final.ptau
fi

# 3) circuit-specific setup (Groth16) + verification key
$SNARKJS groth16 setup drive_proof.r1cs pot_final.ptau drive_0.zkey
echo "demo-entropy-$(date +%s)-$RANDOM" | $SNARKJS zkey contribute drive_0.zkey drive_final.zkey --name="demo"
$SNARKJS zkey export verificationkey drive_final.zkey vkey.json
cd ..

# 4) browser bundle
node bundle.js

# 5) copy artifacts to the apps
mkdir -p ../rental/public/zk
cp build/drive_proof_js/drive_proof.wasm ../rental/public/zk/drive_proof.wasm
cp build/drive_final.zkey               ../rental/public/zk/drive_final.zkey
cp build/pdzk.bundle.js                 ../rental/public/pdzk.bundle.js
cp build/vkey.json                      ../verifier/vkey.json
cp circuits/drive_proof.circom          ../rental/drive_proof.circom
echo "Done. Restart the verifier and rental servers."
