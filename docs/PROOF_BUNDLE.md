# Proof Bundle (Judge Checklist)

## 1) Core build proof
- [x] Intent router contract deployed (Base Sepolia)
- [x] Solver backend implemented (`/health`, `/quote`, `/compete`)
- [x] UI flow implemented (intent input -> competition output)
- [x] Constraint status surfaced (pass/fail)

## 2) Onchain transaction proof
- Contract: `0x759415bE6b7Ef0C58897bE68E245cE5de618F57E`
- Tx #1 setSolver:
  `0x11d98a3d66713099fb5be58738118594730412a518c79bdba50a5e4c6849d7b9`
- Tx #2 createIntent:
  `0x6efd0241b300a5df975746a3efacea592c44f782a92b889c3280aa6a8155b91f`
- Tx #3 fillIntent:
  `0x965c16c3590aa3ad4b8975fb2a46b2b238f1cc9c6fe95fcf6f96df77b0e08acd`

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
