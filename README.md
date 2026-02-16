# Intent Guard (ILM) — AI-Guarded Solver Competition on Base

Intent Guard is an intent liquidity market where users define desired outcomes + risk constraints, and solver agents compete to execute the best valid route — with AI-powered risk analysis guarding every execution.

## What makes this different

- **Real price feeds** — Solvers fetch live token prices from CoinGecko with DexScreener fallback, not mock data
- **ERC20 escrow** — Tokens are locked in the contract on intent creation, transferred atomically on fill
- **Hybrid safety architecture** — Deterministic constraints (min output, gas, slippage) enforced as hard pass/fail gates, with Claude AI as an adaptive anomaly detection layer for contextual risks (MEV, price manipulation)
- **Multi-solver competition** — Three solver profiles (speed-optimized, price-optimized, balanced) compete per intent with differentiated scoring
- **Constraint enforcement** — Min output and deadline enforced onchain; max gas, slippage, and AI risk checks validated offchain by solver competition
- **39 passing tests** — 27 Hardhat contract tests + 12 Vitest backend tests covering scoring, constraints, winner selection, and price metadata

## Live demo

- **Demo page:** [https://ilm-intent-router.vercel.app](https://ilm-intent-router.vercel.app)
- **Contract (Base Sepolia):** `0x759415bE6b7Ef0C58897bE68E245cE5de618F57E`
- **API:** Hosted on Render (see `render.yaml`)

## Architecture

```
User → Intent Guard UI → Solver API (/compete)
                              ↓
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              solver-alpha  solver-beta  solver-gamma
              (speed)       (price)     (balanced)
                    └─────────┼─────────┘
                              ▼
                     Claude AI Risk Analysis
                     (MEV, price, slippage checks)
                              ▼
                    Best valid quote selected
                              ▼
                   IntentRouter.sol (Base Sepolia)
                   ERC20 escrow → fill → settle
```

### How it works

1. User submits intent constraints (token pair, amount, min output, max gas, deadline)
2. Three solver agents fetch real prices and generate competing quotes
3. Quotes are validated offchain against hard constraints (min output, max gas, slippage pass/fail)
4. Claude AI analyzes all quotes for contextual risk (MEV patterns, price anomalies, suspicious quotes)
5. Best valid quote selected — danger-rated quotes excluded from winner pool by AI gate
6. User creates intent onchain (tokens escrowed)
7. Winning solver fills intent (atomic token swap via contract)

## Try it now (one command)

```bash
curl -s -X POST https://ilm-intent-router-api.onrender.com/compete \
  -H "Content-Type: application/json" \
  -d '{"intent":{"tokenIn":"WETH","tokenOut":"USDC","amountIn":"1.0","minAmountOut":"1800","maxSlippageBps":50,"maxGasWei":"50000000000000","deadline":9999999999},"solvers":[{"name":"solver-alpha"},{"name":"solver-beta"},{"name":"solver-gamma"}]}' | python3 -m json.tool
```

Expected response shape:
```json
{
  "best": { "solver": "solver-alpha", "score": 0.753, "valid": true, ... },
  "validQuotes": [ ... ],
  "quotes": [ ... ],
  "riskAnalysis": { "analyzed": true, "recommendation": "...", "quotes": [ ... ] }
}
```

You will see: 3 competing solver quotes with differentiated scores, live prices (CoinGecko + DexScreener fallback), slippage validation, and Claude Opus 4.6 risk analysis rating each quote as safe/caution/danger. Danger-rated quotes are excluded from winner selection.

## Project structure

```
contracts/
  contracts/IntentRouter.sol   — Onchain intent lifecycle with ERC20 escrow
  contracts/MockERC20.sol      — Test mock token
  test/IntentRouter.test.ts    — 27 comprehensive tests
  scripts/deploy.ts            — Deployment script
  scripts/demoFlow.ts          — End-to-end demo flow

backend/
  src/server.ts                — Express API (health, quote, compete, analyze)
  src/solver.ts                — Real solver with CoinGecko price feeds
  src/riskAnalysis.ts          — Claude AI risk analysis module

docs/
  demo.html + demo.js          — Vercel-hosted demo with wallet connect
  ARCHITECTURE.md              — System design

ui/
  index.html + main.js         — Local dev UI
```

## Quickstart

### Backend
```bash
cd backend
npm install
npm run dev          # http://localhost:8787
```

Endpoints:
- `GET /health` — Service health check
- `POST /quote` — Single solver quote
- `POST /compete` — Multi-solver competition + AI risk analysis (supports `strictMode` override)
- `POST /analyze` — Standalone risk analysis
- `GET /resolve/:address` — Resolve contract address to token info
- `GET /search?q=` — Search tokens by name/symbol (Base chain)

### Contracts
```bash
cd contracts
cp .env.example .env   # fill DEPLOYER_PRIVATE_KEY + FEE_RECIPIENT
npm install
npx hardhat compile
npx hardhat test       # 27 passing
npx hardhat run scripts/deploy.ts --network baseSepolia
```

### UI
Open `docs/demo.html` in browser, enter API URL, connect MetaMask to Base Sepolia.

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for AI risk analysis |
| `BASESCAN_API_KEY` | (optional) BaseScan enrichment |
| `PORT` | Backend port (default: 8787) |
| `DEPLOYER_PRIVATE_KEY` | Contract deployer key |
| `FEE_RECIPIENT` | Protocol fee recipient address |

## Onchain proof (Base Sepolia)

- `setSolver`: [`0x11d98a3d66713099fb5be58738118594730412a518c79bdba50a5e4c6849d7b9`](https://base-sepolia.blockscout.com/tx/0x11d98a3d66713099fb5be58738118594730412a518c79bdba50a5e4c6849d7b9)
- `createIntent`: [`0x6efd0241b300a5df975746a3efacea592c44f782a92b889c3280aa6a8155b91f`](https://base-sepolia.blockscout.com/tx/0x6efd0241b300a5df975746a3efacea592c44f782a92b889c3280aa6a8155b91f)
- `fillIntent`: [`0x965c16c3590aa3ad4b8975fb2a46b2b238f1cc9c6fe95fcf6f96df77b0e08acd`](https://base-sepolia.blockscout.com/tx/0x965c16c3590aa3ad4b8975fb2a46b2b238f1cc9c6fe95fcf6f96df77b0e08acd)
- Contract: [`0x759415bE6b7Ef0C58897bE68E245cE5de618F57E`](https://base-sepolia.blockscout.com/address/0x759415bE6b7Ef0C58897bE68E245cE5de618F57E)

## Threat model

| Threat | Mitigation |
|---|---|
| MEV sandwich attack | AI detects suspicious pricing patterns; slippage enforcement rejects high-slippage quotes |
| Malicious solver quote | Danger-rated quotes excluded from winner pool; all-danger scenario returns no winner |
| Price oracle manipulation | Multi-source pricing (CoinGecko + DexScreener); reliability scoring rejects fallback-only prices |
| Stale pricing | 2-minute staleness detection; staleness metadata exposed per-token |
| API abuse | Rate limiting (30 req/min), input validation, request size limits |
| Reentrancy | Custom nonReentrant guard; checks-effects-interactions pattern |
| Quote tampering | SHA-256 execution hash for integrity verification |
| AI unavailable | Graceful fallback — quotes returned as "unanalyzed" with warning |

## Key design decisions

- **Hybrid safety model** — Hard deterministic constraints (min output, gas limit, slippage) as pass/fail gates, Claude Opus 4.6 as adaptive risk layer for contextual anomalies
- **All-danger safety policy** — When all solver quotes are rated "danger" by AI, the system refuses to select a winner and returns remediation hints instead of silently falling through
- **Decomposed scoring** — Non-saturating score formula with weighted components (price quality 50%, gas efficiency 30%, confidence 20%) produces meaningful solver differentiation
- **Slippage enforcement** — Implied slippage computed against fair market price and enforced as a first-class constraint
- **Multi-source pricing** — CoinGecko primary with DexScreener fallback; price source and reliability metadata exposed per-token
- **Price reliability gating** — Quotes using only hardcoded fallback prices are marked unreliable and excluded from valid pool
- **Cryptographic execution hash** — SHA-256 hash of canonicalized quote payload for tamper detection
- **Lightweight reentrancy guard** — Custom `nonReentrant` modifier, no OpenZeppelin dependency
- **Checks-effects-interactions** — State updated before external calls in `fillIntent`
- **Graceful AI fallback** — If no API key or Claude is unreachable, quotes return with "unanalyzed" risk
- **Price caching** — 30s TTL cache with 2-minute staleness detection
- **Seeded PRNG** — Deterministic per-solver variance so same request returns stable quotes within cache window
- **CI pipeline** — GitHub Actions running both contract and backend test suites on every push
