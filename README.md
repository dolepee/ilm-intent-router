# Intent Guard (ILM) — AI-Guarded Solver Competition on Base

Intent Guard is an intent liquidity market where users define desired outcomes + risk constraints, and solver agents compete to execute the best valid route — with AI-powered risk analysis guarding every execution.

## What makes this different

- **Real price feeds** — Solvers fetch live token prices from CoinGecko, not mock data
- **ERC20 escrow** — Tokens are locked in the contract on intent creation, transferred atomically on fill
- **AI risk analysis** — Every solver competition is analyzed by Claude for MEV risk, price anomalies, and slippage danger
- **Multi-solver competition** — Three solver profiles (speed-optimized, price-optimized, balanced) compete per intent
- **Constraint enforcement** — Min output and deadline enforced onchain; max gas and slippage validated offchain by solver competition
- **27 passing tests** — Full Hardhat test suite covering escrow, fills, cancellations, expiry, access control, and fee math

## Live demo

- **Demo page:** [https://intent-guardr.vercel.app](https://intent-guardr.vercel.app)
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
3. Quotes are validated offchain against constraints (min output, max gas, slippage)
4. Claude AI analyzes all quotes for risk (MEV, price anomalies, slippage)
5. Best valid quote is selected (danger-rated quotes excluded by AI)
6. User creates intent onchain (tokens escrowed)
7. Winning solver fills intent (atomic token swap via contract)

## Try it now (one command)

```bash
curl -s -X POST https://ilm-intent-router-api.onrender.com/compete \
  -H "Content-Type: application/json" \
  -d '{"intent":{"tokenIn":"WETH","tokenOut":"USDC","amountIn":"1.0","minAmountOut":"1800","maxGasWei":"50000000000000","deadline":9999999999},"solvers":[{"name":"solver-alpha"},{"name":"solver-beta"},{"name":"solver-gamma"}]}' | python3 -m json.tool
```

You will see: 3 competing solver quotes with live CoinGecko prices, and Claude AI risk analysis rating each quote as safe/caution/danger. Danger-rated quotes are excluded from winner selection.

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
- `POST /compete` — Multi-solver competition + AI risk analysis
- `POST /analyze` — Standalone risk analysis

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

- `setSolver`: `0xeffb17315f650426c8ea5fa347473f3c5b374fb8bd0c1f4e1d912ea60f0f820d`
- `createIntent`: `0xae99503b35666b8cf5c2ab3fdac395c0865099c372dd92e3507932f744a592fd`
- `fillIntent`: `0x7058f43a53f91992fc2166a279e00a637a0b254e8aa5550a8643c7559e6ea16f`

## Key design decisions

- **Lightweight reentrancy guard** — Custom `nonReentrant` modifier, no OpenZeppelin dependency
- **Checks-effects-interactions** — State updated before external calls in `fillIntent`
- **Graceful AI fallback** — If no API key or Claude is unreachable, quotes return with "unanalyzed" risk
- **Price caching** — 30s TTL cache prevents CoinGecko rate limiting
- **Seeded PRNG** — Deterministic per-solver variance so same request returns stable quotes within cache window
