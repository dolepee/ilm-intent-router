# ILM Phase 2 (started)

## Scope
- Base Sepolia contract deployment path
- Basic frontend for intent input + solver competition view
- End-to-end demo wiring prep (`createIntent -> compete -> fillIntent`)

## Delivered in this phase
- Hardhat deployment setup under `contracts/`
  - `hardhat.config.ts`
  - `scripts/deploy.ts`
  - `.env.example`
- Minimal UI under `ui/`
  - `index.html`
  - `main.js`
  - Calls backend `/compete` and displays best solver + all quotes

## Next
- Add interaction script for onchain `createIntent` + `fillIntent`
- Export ABI + connect frontend wallet
- Record deterministic demo flow on Base Sepolia
