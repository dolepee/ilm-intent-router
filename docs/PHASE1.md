# ILM Phase 1 (in progress)

## Objective
Ship end-to-end MVP path:
1. user posts intent
2. internal solvers compete
3. winning solver + proof hash selected
4. onchain fill event emitted

## Current delivery
- `contracts/IntentRouter.sol` (MVP contract)
- `backend/src/server.ts` (quote + compete endpoints)
- `backend/src/solver.ts` (mock solver scoring engine)

## Next (immediate)
- add deploy script (Base Sepolia)
- add minimal UI form for intent creation
- connect backend winner to contract `fillIntent()`
- demo script with one successful intent
