import express from "express";
import cors from "cors";
import { scoreIntent, SolverQuote } from "./solver.js";
import { analyzeRouteRisk, RiskAnalysis } from "./riskAnalysis.js";

const app = express();
app.use(cors());
app.use(express.json());

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
    if (!intent) return res.status(400).json({ error: "intent is required" });
    const quote: SolverQuote = await scoreIntent(intent);
    return res.json(quote);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "quote failed" });
  }
});

app.post("/compete", async (req, res) => {
  try {
    const { intent, solvers } = req.body;
    if (!intent || !Array.isArray(solvers) || solvers.length === 0) {
      return res.status(400).json({ error: "intent + solver configs required" });
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

app.post("/analyze", async (req, res) => {
  try {
    const { intent, quotes } = req.body;
    if (!intent || !Array.isArray(quotes) || quotes.length === 0) {
      return res.status(400).json({ error: "intent + quotes array required" });
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
