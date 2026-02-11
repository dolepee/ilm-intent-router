# Intent Guard Architecture

```mermaid
flowchart LR
    U[Trader / Agent] --> UI[Intent Guard UI]
    UI --> API[Solver API /compete]
    API --> S1[Solver A]
    API --> S2[Solver B]
    API --> S3[Solver C]
    S1 --> API
    S2 --> API
    S3 --> API
    API --> V{Constraint Checks\nminOut + maxGas}
    V -->|valid| W[Best Valid Quote]
    V -->|none valid| F[Best Fallback Quote]
    W --> C[IntentRouter.sol]
    F --> C
    C --> CH[(Base Sepolia)]
```

## Design goals
- User specifies **outcome + constraints**.
- Solvers compete on route quality.
- Selection prioritizes **valid** quotes.
- Execution proof anchored onchain.

## Safety controls
- Min output enforcement
- Max gas guard
- Solver allowlist (current MVP)
- Fee recipient + ownership mutability for operability
