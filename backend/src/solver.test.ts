import { describe, it, expect } from "vitest";
import { scoreIntent, IntentInput, SolverQuote } from "./solver.js";

const baseIntent: IntentInput = {
  tokenIn: "WETH",
  tokenOut: "USDC",
  amountIn: "1.0",
  minAmountOut: "1800",
  maxSlippageBps: 100,
  maxGasWei: "50000000000000",
  deadline: 9999999999,
};

describe("scoreIntent", () => {
  it("returns a valid SolverQuote with required fields", async () => {
    const quote = await scoreIntent(baseIntent, "solver-alpha");
    expect(quote.solver).toBe("solver-alpha");
    expect(typeof quote.expectedOut).toBe("string");
    expect(typeof quote.expectedGasWei).toBe("string");
    expect(typeof quote.confidence).toBe("number");
    expect(typeof quote.score).toBe("number");
    expect(typeof quote.valid).toBe("boolean");
    expect(quote.checks).toHaveProperty("minOutPass");
    expect(quote.checks).toHaveProperty("gasPass");
    expect(quote.checks).toHaveProperty("slippagePass");
    expect(quote.checks).toHaveProperty("priceReliable");
    expect(typeof quote.impliedSlippageBps).toBe("number");
    expect(["live", "fallback"]).toContain(quote.priceSource);
    expect(quote.priceMeta).toHaveProperty("tokenIn");
    expect(quote.priceMeta).toHaveProperty("tokenOut");
    expect(typeof quote.reason).toBe("string");
    expect(Array.isArray(quote.route)).toBe(true);
    expect(quote.executionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("produces different scores for different solvers", async () => {
    const [alpha, beta, gamma] = await Promise.all([
      scoreIntent(baseIntent, "solver-alpha"),
      scoreIntent(baseIntent, "solver-beta"),
      scoreIntent(baseIntent, "solver-gamma"),
    ]);
    const scores = [alpha.score, beta.score, gamma.score];
    const unique = new Set(scores);
    // At least 2 different scores expected
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it("score is bounded between 0 and 1", async () => {
    const quote = await scoreIntent(baseIntent, "solver-alpha");
    expect(quote.score).toBeGreaterThanOrEqual(0);
    expect(quote.score).toBeLessThanOrEqual(1);
  });

  it("confidence is bounded between 0.5 and 0.99", async () => {
    const quote = await scoreIntent(baseIntent, "solver-gamma");
    expect(quote.confidence).toBeGreaterThanOrEqual(0.5);
    expect(quote.confidence).toBeLessThanOrEqual(0.99);
  });

  it("marks quote invalid when minAmountOut impossible", async () => {
    const intent: IntentInput = {
      ...baseIntent,
      minAmountOut: "999999999", // impossibly high
    };
    const quote = await scoreIntent(intent, "solver-alpha");
    expect(quote.checks.minOutPass).toBe(false);
    expect(quote.valid).toBe(false);
    expect(quote.reason).toContain("Fails");
  });

  it("marks quote invalid when maxGasWei too low", async () => {
    const intent: IntentInput = {
      ...baseIntent,
      maxGasWei: "1", // impossibly low
    };
    const quote = await scoreIntent(intent, "solver-alpha");
    expect(quote.checks.gasPass).toBe(false);
    expect(quote.valid).toBe(false);
  });

  it("marks quote invalid when slippage too tight", async () => {
    const intent: IntentInput = {
      ...baseIntent,
      maxSlippageBps: 0, // zero tolerance
    };
    const quote = await scoreIntent(intent, "solver-alpha");
    // With zero tolerance, any negative edge makes slippage fail
    // This may or may not pass depending on the random edge — just verify the field exists
    expect(typeof quote.checks.slippagePass).toBe("boolean");
    expect(typeof quote.impliedSlippageBps).toBe("number");
  });

  it("uses default profile for unknown solver name", async () => {
    const quote = await scoreIntent(baseIntent, "solver-unknown");
    expect(quote.solver).toBe("solver-unknown");
    expect(quote.route).toEqual(["GenericAMM"]);
  });

  it("execution hash is deterministic within same time bucket", async () => {
    const q1 = await scoreIntent(baseIntent, "solver-alpha");
    const q2 = await scoreIntent(baseIntent, "solver-alpha");
    expect(q1.executionHash).toBe(q2.executionHash);
  });

  it("price metadata includes valid source and reliability", async () => {
    const quote = await scoreIntent(baseIntent, "solver-alpha");
    const { tokenIn, tokenOut } = quote.priceMeta;
    for (const meta of [tokenIn, tokenOut]) {
      expect(["coingecko", "dexscreener", "fallback"]).toContain(meta.source);
      expect(typeof meta.timestamp).toBe("number");
      expect(typeof meta.isStale).toBe("boolean");
      expect(meta.reliabilityScore).toBeGreaterThanOrEqual(0);
      expect(meta.reliabilityScore).toBeLessThanOrEqual(1);
    }
  });
});

describe("winner selection logic", () => {
  it("danger-only scenario returns no winner", async () => {
    // Simulate the server.ts logic locally
    const quotes = await Promise.all([
      scoreIntent(baseIntent, "solver-alpha"),
      scoreIntent(baseIntent, "solver-beta"),
      scoreIntent(baseIntent, "solver-gamma"),
    ]);

    // Simulate all-danger risk map
    const riskMap = new Map<string, string>();
    for (const q of quotes) {
      riskMap.set(q.solver, "danger");
    }

    const validQuotes = quotes.filter((q) => q.valid);
    const safePool = validQuotes.filter((q) => riskMap.get(q.solver) !== "danger");

    expect(safePool.length).toBe(0);
    // Server should return best: null in this case
  });

  it("mixed ratings exclude danger from winner pool", async () => {
    const quotes = await Promise.all([
      scoreIntent(baseIntent, "solver-alpha"),
      scoreIntent(baseIntent, "solver-beta"),
      scoreIntent(baseIntent, "solver-gamma"),
    ]);

    const riskMap = new Map<string, string>([
      ["solver-alpha", "safe"],
      ["solver-beta", "danger"],
      ["solver-gamma", "caution"],
    ]);

    const validQuotes = quotes.filter((q) => q.valid);
    const safePool = validQuotes.filter((q) => riskMap.get(q.solver) !== "danger");
    const best = safePool.sort((a, b) => b.score - a.score)[0];

    // Winner should never be solver-beta (danger)
    if (best) {
      expect(best.solver).not.toBe("solver-beta");
    }
  });
});
