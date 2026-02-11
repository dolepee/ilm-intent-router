# Fast Second PR Idea (Low Risk, High Signal)

## Goal
Ship one more small but meaningful Clawlett improvement to strengthen tiebreak narrative.

## Recommended PR
**Add machine-readable JSON output mode to `swap.js` (`--json`)**

### Why this is good
- Helps autonomous agents parse quotes/execution results reliably
- Minimal code change, low break risk
- Improves composability with external strategy/risk layers

### Scope (small)
1. Add `--json` flag in CLI args.
2. Print structured JSON for:
   - quote summary
   - guardrail checks
   - tx hash / status after execution
3. Keep human-readable output as default.

### Suggested acceptance criteria
- Existing workflows unchanged by default.
- `node swap.js ... --json` returns valid JSON only.
- README documents flag and sample output.

## Alternative backup PR (if needed)
- Add `--dry-run` mode that performs all checks and quote retrieval but blocks execution.

Either option is fast and clearly useful for autonomous trading reliability.
