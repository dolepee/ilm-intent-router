# Final Submission — Intent Guard (ILM)

## What we built

**Intent Guard** is an AI-guarded intent liquidity market on Base where:

1. Users define trade constraints (token pair, amount, min output, max gas, deadline)
2. Three competing solver agents fetch **real prices** from CoinGecko and generate quotes
3. **Claude AI** analyzes all quotes for MEV risk, price anomalies, and slippage danger
4. Best valid quote is selected based on constraint satisfaction and score
5. Intent is created onchain with **real ERC20 token escrow**
6. Winning solver fills atomically — tokens transferred, fee collected, execution proven

## What's live

- **Repo:** https://github.com/dolepee/ilm-intent-router
- **Demo:** https://dolepee.github.io/ilm-intent-router/demo.html
- **Network:** Base Sepolia
- **Contract:** `0x759415bE6b7Ef0C58897bE68E245cE5de618F57E`

## Onchain proof (Base Sepolia)

Full escrow flow executed — tokens actually moved:

| Step | Transaction |
|---|---|
| setSolver | `0x11d98a3d66713099fb5be58738118594730412a518c79bdba50a5e4c6849d7b9` |
| createIntent (escrow 1 WETH) | `0x6efd0241b300a5df975746a3efacea592c44f782a92b889c3280aa6a8155b91f` |
| fillIntent (3200 USDC out, 3.2 USDC fee) | `0x965c16c3590aa3ad4b8975fb2a46b2b238f1cc9c6fe95fcf6f96df77b0e08acd` |

Mock tokens deployed for demo:
- WETH: `0xf1cAE578D644F4e2F487B464fEbCc02A70B9ca03`
- USDC: `0x2e0a4169afdcb3Aa04439Ac9E9C045b02ef5cf28`

## Key features

- **Real solver competition** — 3 profiles (speed/price/balanced) with live CoinGecko prices
- **ERC20 escrow** — Tokens locked on create, atomic transfer on fill, returned on cancel/expire
- **AI risk analysis** — Claude Haiku evaluates MEV risk, price anomalies, slippage per quote
- **Reentrancy protection** — Custom lightweight guard, checks-effects-interactions pattern
- **27 passing tests** — Full Hardhat test suite
- **Wallet-connected demo** — MetaMask + Base Sepolia chain switching + onchain intent creation

## Architecture

```
User → Intent Guard UI → Solver API (/compete)
                              ↓
                    [3 competing solvers + CoinGecko prices]
                              ↓
                    [Claude AI Risk Analysis]
                              ↓
                    [Best valid quote selected]
                              ↓
                   IntentRouter.sol (Base Sepolia)
                   [ERC20 escrow → atomic fill → settle]
```

## What's novel

Unlike existing intent protocols (UniswapX, CoW Protocol), Intent Guard adds an **AI risk layer** that screens every solver quote before execution. This catches:

- Suspiciously good quotes (possible sandwich/MEV setup)
- Dangerous slippage tolerance
- Unrealistic gas estimates
- Price anomalies vs live market data

This makes autonomous DeFi execution safer — the AI acts as a guardian between intent submission and execution.
