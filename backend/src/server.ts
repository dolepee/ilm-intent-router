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

app.use(cors());
app.use(express.json({ limit: JSON_LIMIT }));

type RequestBucket = { count: number; resetAt: number };
const requestBuckets = new Map<string, RequestBucket>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    typeof amountIn === "string" &&
    amountIn.trim().length > 0 &&
    typeof minAmountOut === "string" &&
    minAmountOut.trim().length > 0 &&
    typeof maxGasWei === "string" &&
    maxGasWei.trim().length > 0 &&
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

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "ilm-solver-api",
    message: "Intent Guard API is live",
    endpoints: ["/health", "/quote", "/compete", "/analyze"],
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ilm-solver-api", version: "0.3.0", aiEnabled: !!process.env.ANTHROPIC_API_KEY });
});

app.post("/quote", async (req, res) => {
  try {
    const { intent } = req.body;
    if (!isIntentInput(intent)) return res.status(400).json({ error: "valid intent is required" });
    const quote: SolverQuote = await scoreIntent(intent);
    return res.json(quote);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "quote failed" });
  }
});

app.post("/compete", rateLimitExpensiveRoutes, async (req, res) => {
  try {
    const { intent, solvers } = req.body;
    if (!isIntentInput(intent) || !Array.isArray(solvers) || solvers.length === 0) {
      return res.status(400).json({ error: "intent + solver configs required" });
    }
    if (solvers.length > MAX_SOLVERS) {
      return res.status(400).json({ error: `Too many solvers. Maximum allowed is ${MAX_SOLVERS}` });
    }
    if (!solvers.every((s) => isObject(s) && typeof s.name === "string" && s.name.trim().length > 0 && s.name.length <= MAX_NAME_LENGTH)) {
      return res.status(400).json({ error: "Each solver requires a valid name" });
    }

    const quotes: SolverQuote[] = [];
    for (const s of solvers) {
      quotes.push(await scoreIntent(intent, s.name));
    }

    // Run AI risk analysis FIRST
    const riskAnalysis: RiskAnalysis = await analyzeRouteRisk(
      intent,
      quotes as unknown as Record<string, unknown>[],
    );

    // Build risk map: solver -> riskRating
    const riskMap = new Map<string, string>();
    for (const rq of riskAnalysis.quotes) {
      riskMap.set(rq.solver, rq.riskRating);
    }

    // Filter valid quotes that pass constraints
    const validQuotes = quotes.filter((q) => q.valid);

    // AI-gated selection: exclude danger-rated quotes from winner pool
    const safePool = validQuotes.filter((q) => riskMap.get(q.solver) !== "danger");
    const pool = safePool.length > 0 ? safePool : (validQuotes.length > 0 ? validQuotes : quotes);
    const best = pool.sort((a, b) => b.score - a.score)[0];

    return res.json({ best, validQuotes, quotes, riskAnalysis });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "competition failed" });
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
