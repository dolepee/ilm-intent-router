# Proof Bundle (Judge Checklist)

## 1) Core build proof
- [x] Intent router contract deployed (Base Sepolia)
- [x] Solver backend implemented (`/health`, `/quote`, `/compete`)
- [x] UI flow implemented (intent input -> competition output)
- [x] Constraint status surfaced (pass/fail)

## 2) Onchain transaction proof
- Contract: `0x3B923f68E78041e944dB203d06d7f9B6BD62154c`
- Tx #1 setSolver:
  `0xeffb17315f650426c8ea5fa347473f3c5b374fb8bd0c1f4e1d912ea60f0f820d`
- Tx #2 createIntent:
  `0xae99503b35666b8cf5c2ab3fdac395c0865099c372dd92e3507932f744a592fd`
- Tx #3 fillIntent:
  `0x7058f43a53f91992fc2166a279e00a637a0b254e8aa5550a8643c7559e6ea16f`

## 3) Tiebreaker contribution proof
- Upstream PR opened: https://github.com/Creator-Bid/Clawlett/pull/2
- Scope: Optional swap risk guardrails in Clawlett script

## 4) Demo flow proof (2 min)
- Start backend and run quote/competition
- Show best valid quote and fallback behavior
- Present contract + tx hashes
- Explain solver selection logic and constraints

## 5) Attachments to include in final post
- Screenshot: UI intent form + best solver status
- Screenshot: full quotes panel with constraint fields
- Link: Clawlett PR #2
- Link: contract explorer page
- Link: each tx explorer page
