# Clawlett 5,000 USDC Challenge — Submission Draft

## Project
**Intent Guard (ILM: Intent Liquidity Market)** on Base

## What we built
Intent Guard lets a trader specify *intent + constraints* (desired output, max gas, slippage/deadline) while multiple solver agents compete to execute the best valid route.

Instead of hardcoding one route, we run solver competition and enforce constraints as first-class checks.

## Why this matters
- Better execution quality under constraints
- Safer autonomous behavior (constraint-aware selection)
- Verifiable execution artifacts onchain

## Architecture (high-level)
1. User submits intent constraints.
2. Solver backend generates competing quotes.
3. Invalid quotes (constraint failures) are filtered.
4. Best valid quote is selected.
5. Intent lifecycle is settled/recorded onchain.

## Onchain proof
- Network: **Base Sepolia**
- Contract: `0x759415bE6b7Ef0C58897bE68E245cE5de618F57E`
- `setSolver` tx: `0x11d98a3d66713099fb5be58738118594730412a518c79bdba50a5e4c6849d7b9`
- `createIntent` tx: `0x6efd0241b300a5df975746a3efacea592c44f782a92b889c3280aa6a8155b91f`
- `fillIntent` tx: `0x965c16c3590aa3ad4b8975fb2a46b2b238f1cc9c6fe95fcf6f96df77b0e08acd`

## Clawlett PR contribution (tiebreaker)
- PR: https://github.com/Creator-Bid/Clawlett/pull/2
- Title: `feat: add optional risk guardrails for swap execution`
- Added:
  - max balance-usage cap per trade
  - minimum ETH reserve guardrail
  - CLI/env configuration and docs update

## Final note
This submission focuses on practical autonomous trading safety + execution quality:
constraint-driven intent routing, verifiable flow, and clear operational guardrails.
