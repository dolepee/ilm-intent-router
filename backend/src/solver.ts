export type IntentInput = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  maxSlippageBps: number;
  maxGasWei: string;
  deadline: number;
};

export type SolverQuote = {
  solver: string;
  expectedOut: string;
  expectedGasWei: string;
  confidence: number;
  score: number;
  valid: boolean;
  checks: {
    minOutPass: boolean;
    gasPass: boolean;
  };
  reason: string;
  route: string[];
  executionHash: string;
};

function pseudoRand(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

export async function scoreIntent(intent: IntentInput, solver = "solver-alpha"): Promise<SolverQuote> {
  const seed = `${solver}:${intent.tokenIn}:${intent.tokenOut}:${intent.amountIn}`;
  const r = pseudoRand(seed);

  const amountIn = Number(intent.amountIn);
  const expectedOut = amountIn * (0.97 + r * 0.06); // mock execution quality
  const expectedGasWei = Math.floor(2.5e13 + r * 1.4e13);

  const slippagePenalty = Math.max(0, (20 - intent.maxSlippageBps) / 20);
  const gasPass = expectedGasWei <= Number(intent.maxGasWei);
  const minOutPass = expectedOut >= Number(intent.minAmountOut);
  const gasPenalty = gasPass ? 0 : 0.25;
  const quality = Math.min(1, expectedOut / Number(intent.minAmountOut));

  const score = Math.max(0, quality * 0.65 + (1 - slippagePenalty) * 0.2 + (1 - gasPenalty) * 0.15);
  const valid = gasPass && minOutPass;

  return {
    solver,
    expectedOut: expectedOut.toFixed(6),
    expectedGasWei: String(expectedGasWei),
    confidence: Number((0.55 + r * 0.4).toFixed(2)),
    score: Number(score.toFixed(3)),
    valid,
    checks: { minOutPass, gasPass },
    reason: valid
      ? "Meets all constraints with competitive output"
      : (!minOutPass ? "Fails min output constraint" : "Fails max gas constraint"),
    route: ["Pool-A", "Pool-B"],
    executionHash: `0x${Buffer.from(seed).toString("hex").slice(0, 64).padEnd(64, "0")}`,
  };
}
