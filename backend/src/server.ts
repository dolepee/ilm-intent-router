import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { IntentInput, scoreIntent, SolverQuote, resolveContractAddress, searchTokens } from "./solver.js";
import { analyzeRouteRisk, RiskAnalysis } from "./riskAnalysis.js";

const app = express();
const JSON_LIMIT = process.env.JSON_LIMIT || "32kb";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30);
const MAX_SOLVERS = Number(process.env.MAX_SOLVERS || 8);
const MAX_QUOTES = Number(process.env.MAX_QUOTES || 12);
const MAX_NAME_LENGTH = Number(process.env.MAX_SOLVER_NAME_LENGTH || 64);

// CORS allowlist — open for demo/hackathon, restrict in production
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : ["https://ilm-intent-router.vercel.app", "http://localhost:3000", "http://localhost:5173"];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, mobile)
    if (!origin || ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*")) {
      callback(null, true);
    } else {
      callback(null, true); // Permissive for hackathon demo — log in production
    }
  },
}));
app.use(express.json({ limit: JSON_LIMIT }));

type RequestBucket = { count: number; resetAt: number };
const requestBuckets = new Map<string, RequestBucket>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumericString(s: unknown): boolean {
  return typeof s === "string" && s.trim().length > 0 && Number.isFinite(Number(s)) && !Number.isNaN(Number(s));
}

function isIntentInput(value: unknown): value is IntentInput {
  if (!isObject(value)) return false;
  const {
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    maxSlippageBps,
    maxGasWei,
    deadline,
  } = value;
  return (
    typeof tokenIn === "string" &&
    tokenIn.trim().length > 0 &&
    typeof tokenOut === "string" &&
    tokenOut.trim().length > 0 &&
    isNumericString(amountIn) &&
    Number(amountIn as string) > 0 &&
    isNumericString(minAmountOut) &&
    Number(minAmountOut as string) > 0 &&
    isNumericString(maxGasWei) &&
    Number(maxGasWei as string) > 0 &&
    typeof maxSlippageBps === "number" &&
    Number.isFinite(maxSlippageBps) &&
    maxSlippageBps >= 0 &&
    maxSlippageBps <= 10_000 &&
    typeof deadline === "number" &&
    Number.isFinite(deadline)
  );
}

function getClientIp(req: Request): string {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.trim().length > 0) {
    return xForwardedFor.split(",")[0].trim();
  }
  if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
    return xForwardedFor[0];
  }
  return req.ip || "unknown";
}

function rateLimitExpensiveRoutes(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const ip = getClientIp(req);
  const bucket = requestBuckets.get(ip);

  if (requestBuckets.size > 2000) {
    for (const [key, value] of requestBuckets.entries()) {
      if (value.resetAt <= now) {
        requestBuckets.delete(key);
      }
    }
  }

  if (!bucket || now >= bucket.resetAt) {
    requestBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "Too many requests. Please retry shortly." });
    return;
  }

  bucket.count += 1;
  next();
}

// In-memory solver reputation tracker
type SolverReputation = {
  totalQuotes: number;
  safeQuotes: number;
  dangerQuotes: number;
  wins: number;
  avgScore: number;
  lastSeen: number;
};
const solverReputation = new Map<string, SolverReputation>();

function updateReputation(solver: string, riskRating: string, score: number, isWinner: boolean): void {
  const rep = solverReputation.get(solver) || { totalQuotes: 0, safeQuotes: 0, dangerQuotes: 0, wins: 0, avgScore: 0, lastSeen: 0 };
  rep.totalQuotes++;
  if (riskRating === "safe" || riskRating === "caution") rep.safeQuotes++;
  if (riskRating === "danger") rep.dangerQuotes++;
  if (isWinner) rep.wins++;
  rep.avgScore = ((rep.avgScore * (rep.totalQuotes - 1)) + score) / rep.totalQuotes;
  rep.lastSeen = Date.now();
  solverReputation.set(solver, rep);
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "ilm-solver-api",
    message: "Intent Guard API is live",
    endpoints: ["/health", "/quote", "/compete", "/analyze", "/simulate", "/reputation"],
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ilm-solver-api", version: "0.5.0", commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "dev", aiEnabled: !!process.env.ANTHROPIC_API_KEY });
});

app.post("/quote", async (req, res) => {
  try {
    const { intent } = req.body;
    if (!isIntentInput(intent)) return res.status(400).json({ error: "valid intent is required", code: "INVALID_INPUT" });
    const quote: SolverQuote = await scoreIntent(intent);
    return res.json(quote);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "quote failed", code: "INTERNAL_ERROR" });
  }
});

app.post("/compete", rateLimitExpensiveRoutes, async (req, res) => {
  try {
    const { intent, solvers, strictMode } = req.body;
    if (!isIntentInput(intent) || !Array.isArray(solvers) || solvers.length === 0) {
      return res.status(400).json({ error: "intent + solver configs required", code: "INVALID_INPUT" });
    }
    if (solvers.length > MAX_SOLVERS) {
      return res.status(400).json({ error: `Too many solvers. Maximum allowed is ${MAX_SOLVERS}`, code: "TOO_MANY_SOLVERS" });
    }
    if (!solvers.every((s) => isObject(s) && typeof s.name === "string" && s.name.trim().length > 0 && s.name.length <= MAX_NAME_LENGTH)) {
      return res.status(400).json({ error: "Each solver requires a valid name", code: "INVALID_SOLVER" });
    }

    // Parallelize solver scoring for lower latency
    const quotes: SolverQuote[] = await Promise.all(
      solvers.map((s) => scoreIntent(intent, s.name)),
    );

    // Run AI risk analysis
    const riskAnalysis: RiskAnalysis = await analyzeRouteRisk(
      intent,
      quotes as unknown as Record<string, unknown>[],
    );

    // Build risk map: solver -> riskRating
    // Default missing solvers to "caution" so unanalyzed quotes don't silently pass
    const riskMap = new Map<string, string>();
    for (const rq of riskAnalysis.quotes) {
      riskMap.set(rq.solver, rq.riskRating);
    }
    for (const q of quotes) {
      if (!riskMap.has(q.solver)) {
        riskMap.set(q.solver, "caution");
      }
    }

    // Filter valid quotes that pass deterministic constraints
    const validQuotes = quotes.filter((q) => q.valid);

    // AI-gated selection: exclude danger-rated quotes from winner pool
    const safePool = validQuotes.filter((q) => riskMap.get(q.solver) !== "danger");

    // Safety policy: handle all-danger scenario
    if (safePool.length === 0) {
      const allDanger = validQuotes.length > 0 && validQuotes.every((q) => riskMap.get(q.solver) === "danger");
      const noValid = validQuotes.length === 0;

      // strictMode override: allow danger quote selection (default: false)
      if (allDanger && strictMode === true) {
        const pool = validQuotes.sort((a, b) => b.score - a.score);
        return res.json({
          best: pool[0],
          validQuotes,
          quotes,
          riskAnalysis,
          warning: "All quotes were danger-rated. Winner selected via strict override.",
          code: "DANGER_OVERRIDE",
        });
      }

      // Default: refuse to select a winner when all are dangerous
      return res.json({
        best: null,
        validQuotes,
        quotes,
        riskAnalysis,
        warning: allDanger
          ? "All solver quotes were rated DANGER by AI risk analysis. No winner selected for your safety."
          : noValid
            ? "No quotes passed deterministic constraints (min output, gas, slippage, price reliability)."
            : "No safe quotes available.",
        code: allDanger ? "ALL_DANGER" : noValid ? "NO_VALID_QUOTES" : "NO_SAFE_QUOTES",
        remediation: allDanger
          ? ["Try a different token pair", "Reduce trade size", "Wait for better market conditions", "Enable strictMode to override (advanced)"]
          : noValid
            ? ["Increase slippage tolerance", "Increase max gas", "Decrease minimum output amount"]
            : ["Retry the competition"],
      });
    }

    const best = safePool.sort((a, b) => b.score - a.score)[0];

    // Update solver reputations
    for (const q of quotes) {
      const rating = riskMap.get(q.solver) || "unanalyzed";
      updateReputation(q.solver, rating, q.score, q.solver === best.solver);
    }

    return res.json({ best, validQuotes, quotes, riskAnalysis });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "competition failed", code: "INTERNAL_ERROR" });
  }
});

// Resolve a contract address to token info via DexScreener
app.get("/resolve/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "Invalid contract address" });
    }
    const info = await resolveContractAddress(address);
    if (!info) return res.status(404).json({ error: "Token not found on DexScreener" });
    return res.json(info);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "resolve failed" });
  }
});

// Search tokens by name/symbol via DexScreener
app.get("/search", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 2) return res.status(400).json({ error: "Query must be at least 2 characters" });
    if (q.length > 64) return res.status(400).json({ error: "Query is too long" });
    const results = await searchTokens(q);
    return res.json({ results });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "search failed" });
  }
});

// Pre-trade simulation: dry-run competition without AI cost
app.post("/simulate", async (req, res) => {
  try {
    const { intent, solvers } = req.body;
    if (!isIntentInput(intent) || !Array.isArray(solvers) || solvers.length === 0) {
      return res.status(400).json({ error: "intent + solver configs required", code: "INVALID_INPUT" });
    }
    if (solvers.length > MAX_SOLVERS) {
      return res.status(400).json({ error: `Too many solvers. Maximum allowed is ${MAX_SOLVERS}`, code: "TOO_MANY_SOLVERS" });
    }

    const quotes: SolverQuote[] = [];
    for (const s of solvers) {
      if (isObject(s) && typeof s.name === "string") {
        quotes.push(await scoreIntent(intent, s.name));
      }
    }

    const validQuotes = quotes.filter((q) => q.valid);
    const best = validQuotes.sort((a, b) => b.score - a.score)[0] || null;
    const constraintSummary = {
      allPassMinOut: quotes.every((q) => q.checks.minOutPass),
      allPassGas: quotes.every((q) => q.checks.gasPass),
      allPassSlippage: quotes.every((q) => q.checks.slippagePass),
      allPriceReliable: quotes.every((q) => q.checks.priceReliable),
      validCount: validQuotes.length,
      totalCount: quotes.length,
    };

    return res.json({
      simulated: true,
      best,
      quotes,
      constraintSummary,
      note: "Dry-run simulation — no AI risk analysis performed. Use /compete for full analysis.",
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "simulation failed", code: "INTERNAL_ERROR" });
  }
});

// Solver reputation leaderboard
app.get("/reputation", (_req, res) => {
  const entries = Array.from(solverReputation.entries()).map(([solver, rep]) => ({
    solver,
    ...rep,
    winRate: rep.totalQuotes > 0 ? Number((rep.wins / rep.totalQuotes).toFixed(3)) : 0,
    safetyRate: rep.totalQuotes > 0 ? Number((rep.safeQuotes / rep.totalQuotes).toFixed(3)) : 0,
  }));
  entries.sort((a, b) => b.winRate - a.winRate);
  return res.json({ solvers: entries });
});

app.post("/analyze", rateLimitExpensiveRoutes, async (req, res) => {
  try {
    const { intent, quotes } = req.body;
    if (!isIntentInput(intent) || !Array.isArray(quotes) || quotes.length === 0) {
      return res.status(400).json({ error: "intent + quotes array required" });
    }
    if (quotes.length > MAX_QUOTES) {
      return res.status(400).json({ error: `Too many quotes. Maximum allowed is ${MAX_QUOTES}` });
    }
    if (!quotes.every((q) => isObject(q))) {
      return res.status(400).json({ error: "quotes must be objects" });
    }

    const riskAnalysis: RiskAnalysis = await analyzeRouteRisk(intent, quotes);
    return res.json(riskAnalysis);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "analysis failed" });
  }
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`ILM solver API running on :${PORT}`);
  console.log(`AI risk analysis: ${process.env.ANTHROPIC_API_KEY ? "ENABLED" : "DISABLED (no ANTHROPIC_API_KEY)"}`);
});
