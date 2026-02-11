# Final Submission (Ready to Paste)

## Intent Guard (ILM) — Base

We built **Intent Guard**, an intent liquidity market prototype where users define desired outcomes + risk constraints, and solver agents compete to execute the best valid route.

### What’s live
- Repo: https://github.com/dolepee/ilm-intent-router
- Demo page: https://dolepee.github.io/ilm-intent-router/
- Network: Base Sepolia
- Contract: `0x3B923f68E78041e944dB203d06d7f9B6BD62154c`

### Onchain proof
- setSolver: `0xeffb17315f650426c8ea5fa347473f3c5b374fb8bd0c1f4e1d912ea60f0f820d`
- createIntent: `0xae99503b35666b8cf5c2ab3fdac395c0865099c372dd92e3507932f744a592fd`
- fillIntent: `0x7058f43a53f91992fc2166a279e00a637a0b254e8aa5550a8643c7559e6ea16f`

### Core novelty
- Constraint-first execution model (minOut/maxGas checks)
- Multi-solver competition and best-valid selection
- Transparent execution artifacts

### Scope note
This submission is strictly for **Intent Guard (ILM)**.
Any Clawlett pull requests are parallel contributions and should be evaluated separately from this ILM build.
