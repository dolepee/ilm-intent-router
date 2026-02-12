# ILM Demo Runbook (2 mins)

## Links / IDs
- Contract (Base Sepolia): `0x759415bE6b7Ef0C58897bE68E245cE5de618F57E`
- Successful intent ID: `1`

## Proof transactions
- setSolver: `0x11d98a3d66713099fb5be58738118594730412a518c79bdba50a5e4c6849d7b9`
- createIntent: `0x6efd0241b300a5df975746a3efacea592c44f782a92b889c3280aa6a8155b91f`
- fillIntent: `0x965c16c3590aa3ad4b8975fb2a46b2b238f1cc9c6fe95fcf6f96df77b0e08acd`

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
