import express from "express";
import cors from "cors";
import { scoreIntent, SolverQuote } from "./solver";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ilm-solver-api", version: "0.1.0" });
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

    const validQuotes = quotes.filter((q) => q.valid);
    const pool = validQuotes.length ? validQuotes : quotes;
    const best = pool.sort((a, b) => b.score - a.score)[0];
    return res.json({ best, validQuotes, quotes });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "competition failed" });
  }
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`ILM solver API running on :${PORT}`);
});
