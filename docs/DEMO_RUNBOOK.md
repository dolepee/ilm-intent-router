# ILM Demo Runbook (2 mins)

## Links / IDs
- Contract (Base Sepolia): `0x3B923f68E78041e944dB203d06d7f9B6BD62154c`
- Successful intent ID: `1`

## Proof transactions
- setSolver: `0xeffb17315f650426c8ea5fa347473f3c5b374fb8bd0c1f4e1d912ea60f0f820d`
- createIntent: `0xae99503b35666b8cf5c2ab3fdac395c0865099c372dd92e3507932f744a592fd`
- fillIntent: `0x7058f43a53f91992fc2166a279e00a637a0b254e8aa5550a8643c7559e6ea16f`

## Scripted flow
1. Start backend:
   ```bash
   cd backend && npm install && npm run dev
   ```
2. Open `ui/index.html` and input intent constraints.
3. Click **Run Solver Competition**.
4. Show:
   - best solver quote
   - constraints pass/fail status
   - fallback behavior when constraints fail
5. Show onchain proof:
   - contract address
   - tx hashes
   - intent status filled onchain

## Judge-facing takeaway
- User defines intent + hard constraints.
- Internal solver agents compete.
- Best valid route selected.
- Execution and proof recorded onchain.
