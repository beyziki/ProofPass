# ProofPass

A working demo of **zero-knowledge proofs (Groth16) for privacy-preserving eligibility checks**, built for a Data Privacy course.

A car-rental site needs to know whether a driver is **at least 25 years old**, has held a **driving license for at least 2 years**, and holds a **license class that allows passenger cars (B or above)**. With ProofPass, the rental site learns exactly three yes/no answers. It never sees the birth date, the license date, the license class or the national ID number, not even inside the proof.

> **All data is synthetic.** No real identity data, no real government service. KimlikKasası is a fictional e-Government-style portal. Do not enter real personal data or real passwords anywhere.

---

## Contents

1. [What you get](#what-you-get)
2. [Architecture](#architecture)
3. [Requirements](#requirements)
4. [Quick start](#quick-start)
5. [Demo walkthrough](#demo-walkthrough)
6. [Demo users](#demo-users)
7. [How the proof works](#how-the-proof-works)
8. [The two flows: ZKP vs. classic](#the-two-flows-zkp-vs-classic)
9. [Project structure](#project-structure)
10. [Configuration](#configuration)
11. [Rebuilding the circuit and trusted setup](#rebuilding-the-circuit-and-trusted-setup)
12. [Testing](#testing)
13. [Troubleshooting](#troubleshooting)
14. [Limitations and honest caveats](#limitations-and-honest-caveats)

---

## What you get

Three independent services plus a browser wallet:

| Service | Folder | Port | Role |
|---|---|---|---|
| **KimlikKasası** (identity provider) | `provider/` | 4000 | Holds the citizen database (SQLite, 300 synthetic people), login, registration, consent screen, signs credentials |
| **PrivacyDrive** (relying party) | `rental/` | 3000 | The car-rental website. Has no access to the provider database and never sees proofs |
| **Verifier** | `verifier/` | 5000 | Verifies Groth16 proofs and tells the rental server only `true`/`false` per claim |
| **Wallet** | runs in the browser (`rental/public`) | n/a | Stores the signed credential in `localStorage` and generates the proof locally |

The UI language is Turkish.

## Architecture

```
                    1. consent + signed credential
   ┌──────────────┐ ───────────────────────────────▶ ┌────────────────────┐
   │ KimlikKasası │                                  │  Browser (wallet)  │
   │   :4000      │ ◀─ issuer public key ─┐          │  credential stays  │
   │  SQLite DB   │                       │          │  here, proof is    │
   └──────────────┘                       │          │  generated here    │
                                          │          └─────────┬──────────┘
                                          │       2. open      │ 3. proof (direct)
   ┌──────────────┐  session + nonce      │          session   │
   │ PrivacyDrive │ ────────────────▶ ┌───┴──────────┐ ◀───────┘
   │   :3000      │ ◀─ true/false ─── │  Verifier    │
   │  JSON store  │   (3 booleans)    │   :5000      │
   └──────────────┘                   └──────────────┘
```

1. The user signs in at KimlikKasası and consents. KimlikKasası returns an **EdDSA-signed credential** (birth date, license date, license class, per-site pseudonym) to the **browser wallet**, not to the rental server.
2. The rental server opens a **session** at the verifier (authenticated with a client secret) and receives a one-time **nonce**.
3. The wallet generates a **Groth16 proof** in the browser and sends it **directly to the verifier**. The rental server never sees the proof.
4. The rental server asks the verifier for the result and gets only `{ age_over_25, license_2y, class_ok }`.

## Requirements

- **Node.js 22.13 or newer** (KimlikKasası uses the built-in `node:sqlite` module). Check with `node --version`.
- npm (comes with Node.js).
- A modern browser (Chrome, Edge, Firefox). Open the sites via `localhost`, not `127.0.0.1` (CORS origins are configured for `http://localhost:3000`).
- Free ports **3000, 4000, 5000**.
- *Only if you want to rebuild the circuit:* [circom 2.1.9](https://docs.circom.io/getting-started/installation/). The compiled circuit, proving key and verification key are already included.

## Quick start

Open **three terminals** in the project root.

**Terminal 1: KimlikKasası (provider)**

```bash
cd provider
npm install
npm run seed      # creates data/provider.db with 300 synthetic citizens
npm start
```

**Terminal 2: Verifier**

```bash
cd verifier
npm install
npm start
```

**Terminal 3: PrivacyDrive (rental)**

```bash
cd rental
npm start         # no dependencies to install
```

Then open **http://localhost:3000**.

> Start the provider first. The verifier and the rental server fetch the issuer's public key from it.

To stop a service, press `Ctrl+C` in its terminal.

## Demo walkthrough

1. Open http://localhost:3000, go to **Hesap oluştur** (create account), enter any name and e-mail, and click **KimlikKasası ile bağla**.
2. You land on KimlikKasası (port 4000). Sign in with one of the [demo users](#demo-users) (password `demo123`), or click **Demo hesabı oluştur** to register your own synthetic person (see below). Approve the consent screen.
3. Back on PrivacyDrive, pick a car and continue to the reservation. Choose **Gerçek ZKP (Groth16)** and click **Doğrulamayı başlat**.
4. The result screen shows the three conditions and exactly what went where:
   - the proof sent from the wallet to the verifier,
   - the request received by the rental server,
   - the verifier's answer,
   - the record stored in the rental database.
5. Try the **attack buttons**: replay the same proof, or flip one of the three result bits. The verifier rejects both.
6. Repeat with **Klasik demo** (classic flow) to see the contrast: the rental server receives and stores name, ID number, birth date and license data.
7. Open **Hesabım → Veritabanını göster** (or http://localhost:3000/api/db-dump) to inspect the rental server's data.
8. **Analitik** page: runs a batch benchmark (classic vs. ZKP) with real proofs and tampered proofs.

### Register your own synthetic person

On the KimlikKasası sign-in screen, click **Demo hesap oluştur**. Enter name, birth date, city, license class and license date, and a password. The server **assigns a synthetic 11-digit ID number** (starting with `9`) so no real ID number is ever entered. This lets you build edge cases, for example someone aged 24 with a 1-year-old license.

### Signing out

PrivacyDrive has a **Çıkış yap** (sign out) button. The credential stays in the wallet on this device, so you can use **… olarak giriş yap** to sign back in without going through KimlikKasası again. **Hesabı sil** also removes the credential from the wallet.

## Demo users

The first six citizens in the seed are scripted scenarios (password for all: `demo123`):

| # | Name | ID no. (synthetic) | Profile | Expected result |
|---|---|---|---|---|
| 1 | Nehir Öztürk | 74018253294 | 31 y, class B since 2014 | eligible |
| 2 | Esra Özdemir | 81430731030 | 23 y, class B | fails **age** |
| 3 | Elif Özdemir | 90117251686 | 28 y, class B since 2026-02-14 | fails **license ≥ 2 years** |
| 4 | Dilara Kılıç | 88236364867 | 35 y, class A2 (motorcycle) | fails **class** |
| 5 | Merve Erdem | 22972498280 | 40 y, no license | fails **license** and **class** |
| 6 | Emre Kara | 54343752698 | 26 y, class C since 2019 | eligible |

The sign-in screen also lists these accounts, so you can click one to fill the form. Results are computed against the **pickup date**, so scenarios 2 and 3 flip over time (for example, Elif reaches a 2-year-old license on 2028-02-14).

## How the proof works

### Credential

KimlikKasası signs `M = Poseidon(birth, licDate, classRank, subject)` with **EdDSA over BabyJubJub (Poseidon hash)**:

| Field | Meaning |
|---|---|
| `birth` | birth date as integer `YYYYMMDD` |
| `licDate` | license date as `YYYYMMDD`, `0` = no license |
| `classRank` | `0` none, `1` A2, `2` B, `3` C |
| `subject` | per-site pseudonym derived from the citizen id and the relying party (HMAC), so the rental site cannot link users across sites |

### Circuit (`zk/circuits/drive_proof.circom`)

- **Private inputs:** `birth`, `licDate`, `classRank`, signature (`R8x`, `R8y`, `S`).
- **Public inputs:** issuer public key (`issuerAx`, `issuerAy`), `asOf` (pickup date), `subject`, `nonce`.
- **Public outputs:** three bits.

The circuit checks:

1. the EdDSA signature over `Poseidon(birth, licDate, classRank, subject)` is valid under the issuer key;
2. `age_over_25`: `birth <= asOf - 250000`;
3. `license_2y`: `licDate <= asOf - 20000` **and** `licDate != 0`;
4. `class_ok`: `classRank >= 2`.

About 4,583 non-linear constraints. Proof generation takes roughly 1–2 seconds in the browser, verification takes a few milliseconds.

`publicSignals` order (what the verifier receives):

```
[ age_over_25, license_2y, class_ok, issuerAx, issuerAy, asOf, subject, nonce ]
```

### What the verifier checks

- the issuer key in the proof equals the provider's published key;
- `asOf`, `subject` and `nonce` match the session opened by the rental server (binds the proof to this account, this date and this one-time session);
- the Groth16 proof verifies;
- the session was not used before (replay protection).

## The two flows: ZKP vs. classic

| | Classic (contrast) | ZKP |
|---|---|---|
| Data sent to the rental server | name, e-mail, birth date, ID no., license class, license date | nothing personal |
| Where conditions are evaluated | rental server | wallet proves, verifier checks |
| Sensitive fields stored by rental | 4 | 0 |
| What the rental DB keeps | all fields | `age_over_25`, `license_2y`, `class_ok`, `eligibility_result` |

The classic flow is intentionally implemented as a plain "share the profile" integration so the difference is visible and measurable.

## Project structure

```
ProofPass/
├── provider/            KimlikKasası: backend + portal UI
│   ├── server.js        API: login, register, consent, token, credential signing
│   ├── seed.js          generates the synthetic citizen database
│   └── public/          portal frontend (single page)
├── rental/              PrivacyDrive: rental site (server + UI + wallet)
│   ├── server.js        accounts, reservations, verifier session handling
│   ├── drive_proof.circom   copy of the circuit (for reference)
│   └── public/
│       ├── index.html   site UI, wallet, proof flow, analytics
│       ├── pdzk.bundle.js   browser bundle (snarkjs + circomlibjs + helpers)
│       └── zk/          drive_proof.wasm, drive_final.zkey (circuit + proving key)
├── verifier/            standalone proof verifier
│   ├── server.js
│   └── vkey.json        Groth16 verification key
└── zk/                  circuit sources and build tooling
    ├── circuits/drive_proof.circom
    ├── src/             crypto helpers (lib.js) and browser entry (browser.js)
    ├── build.sh         compile + trusted setup + bundle + copy artifacts
    └── test.js          circuit tests
```

Runtime data (not committed): `provider/data/` (SQLite database and issuer key) and `rental/data/rental.json`.

## Configuration

Defaults work out of the box. Overrides via environment variables:

| Variable | Used by | Default |
|---|---|---|
| `PORT` | all | 4000 / 3000 / 5000 |
| `PROVIDER_URL` | rental, verifier | `http://localhost:4000` |
| `VERIFIER_URL` | rental | `http://localhost:5000` |
| `CLIENT_SECRET` | rental, verifier | `privacydrive-demo-secret` |

The relying-party registration (client id `privacydrive`, allowed origin `http://localhost:3000`, redirect URI) is defined in `provider/server.js`. If you change ports or run on another host, update the origin lists in `provider/server.js` and `verifier/server.js`.

Seed a different number of citizens: `npm run seed -- 1000` (re-running the seed **replaces the database**, including users you registered).

## Rebuilding the circuit and trusted setup

Only needed if you change the circuit. The repository already contains the compiled artifacts.

```bash
cd zk
npm install
# circom 2.1.9 must be on PATH
npm run build        # = bash build.sh
```

`build.sh` compiles the circuit, runs a **demo** powers-of-tau and Groth16 setup, exports the verification key, builds the browser bundle and copies everything to `rental/` and `verifier/`. Restart the verifier and rental servers afterwards.

Every run creates **new proving and verification keys**, so proofs generated with the old `drive_final.zkey` will not verify against the new `vkey.json`. Always replace the proving key (`rental/public/zk/`) and the verification key (`verifier/vkey.json`) together, which `build.sh` does. Credentials (the issuer's signatures) do not depend on the setup and stay valid. If you change the circuit's inputs or outputs, also update `zk/src/lib.js`, `provider/server.js` and the verifier's `publicSignals` handling.

## Testing

```bash
cd zk
npm test
```

Covers: the three claims at boundary dates (exactly 2 years, one day short), class A2 vs. B vs. C, no license, tampered result bits (verification fails), a credential signed by a different key (no proof can be generated) and an edited license date or class (signature no longer matches).

## Troubleshooting

| Problem | Fix |
|---|---|
| `Veritabanı yok. Önce: npm run seed` | Run `npm run seed` in `provider/` |
| `Cannot find module 'circomlibjs'` (provider) or `snarkjs` (verifier) | Run `npm install` in that folder |
| `EADDRINUSE` on 3000/4000/5000 | An old instance is still running. Find and stop it (Windows: `netstat -ano \| findstr :4000`, then `taskkill /PID <pid> /F`) |
| `node:sqlite` not found / `ERR_UNKNOWN_BUILTIN_MODULE` | Upgrade Node.js to 22.13 or newer |
| Reservation shows "Cüzdanda bu hesap için güncel kimlik kartı yok" | The wallet has no credential for this account (new browser, cleared site data, or old credential format). Delete the account on the rental site and link it again |
| Proof generation fails or hangs on first use | The first proof downloads about 6 MB of circuit files. Wait a moment and retry. Make sure the verifier is running |
| Consent page says "İzin verilmeyen köken" | Open the rental site as `http://localhost:3000`, not `127.0.0.1` |
| Provider crashes after changing the issuer key | The issuer key lives in `provider/data/issuer.key.json`. Re-seeding keeps it; deleting `provider/data` creates a new one and invalidates old credentials |
| Nothing changes after editing `server.js` | Restart that service. Static page changes only need a browser refresh (`Ctrl+Shift+R`) |

## Limitations and honest caveats

This is a teaching prototype, not a production identity system.

- **The ZKP is real, the trust setup is not production-grade.** Groth16 needs a trusted setup. This repo uses a single-party local setup, which is fine for a demo and unsafe for production.
- **The result bits are disclosed.** The verifier and rental server learn whether each condition holds. That is the intended output, and it is still information.
- **Same-site linkability.** The per-site pseudonym is stable, so the rental site can recognize the same user across visits (but not across different relying parties).
- **The wallet shares an origin with the rental site.** The credential lives in `localStorage` of `http://localhost:3000`. A real wallet would be a separate app or browser extension, otherwise the site's own JavaScript could in principle read it.
- **Trust in the issuer.** If KimlikKasası signs wrong data, the proof is faithfully wrong. The provider also learns that a credential was issued to this relying party (but not when or whether it is used).
- **Classic mode is intentionally not private.** It exists only as the baseline for comparison.
- **Demo-grade security elsewhere.** No HTTPS, a hard-coded demo client secret, simple rate limiting, a JSON file as the rental database, scrypt with demo parameters for the demo passwords.

## License

Educational use. Add your preferred license before reusing the code elsewhere.
