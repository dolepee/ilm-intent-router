# ILM — Intent Liquidity Market (MVP)

Risk-bounded intent execution for Base.

## Concept
Users post *what they want* (intent) + constraints (max slippage, max gas, deadline).
Internal solver agents compete to provide the best valid execution.
Winning solver is settled onchain with a proof hash.

## Why this matters
- Better UX than manual route-hunting
- Enforced risk constraints
- Composable with existing DEX liquidity

## Project structure
- `contracts/IntentRouter.sol` — onchain intent lifecycle
- `backend/` — solver quote + competition API
- `docs/PHASE1.md` — implementation tracker

## Quickstart (backend)
```bash
cd backend
npm install
npm run dev
```

Endpoints:
- `GET /health`
- `POST /quote` with `{ intent }`
- `POST /compete` with `{ intent, solvers: [{name:"solver-alpha"},{name:"solver-beta"}] }`

## Contracts (Base Sepolia deploy)
```bash
cd contracts
cp .env.example .env
npm install
npm run build
npm run deploy:base-sepolia
```

## UI (local)
Open `ui/index.html` in browser and ensure backend is running on `:8787`.

## Notes
Phase 1 + Phase 2 scaffold complete.
Next: wire wallet + onchain create/fill flow for full demo.
