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
- Contract: `0x3B923f68E78041e944dB203d06d7f9B6BD62154c`
- `setSolver` tx: `0xeffb17315f650426c8ea5fa347473f3c5b374fb8bd0c1f4e1d912ea60f0f820d`
- `createIntent` tx: `0xae99503b35666b8cf5c2ab3fdac395c0865099c372dd92e3507932f744a592fd`
- `fillIntent` tx: `0x7058f43a53f91992fc2166a279e00a637a0b254e8aa5550a8643c7559e6ea16f`

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
