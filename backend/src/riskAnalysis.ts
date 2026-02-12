import Anthropic from "@anthropic-ai/sdk";

export type RiskRating = "safe" | "caution" | "danger" | "unanalyzed";

export type QuoteRisk = {
  solver: string;
  riskRating: RiskRating;
  riskNote: string;
};

export type RiskAnalysis = {
  analyzed: boolean;
  recommendation: string;
  quotes: QuoteRisk[];
};

function buildPrompt(intent: Record<string, unknown>, quotes: Record<string, unknown>[]): string {
  return `You are Intent Guard, an AI risk analyzer for DeFi trade routes.

Analyze the following intent and solver quotes for potential risks.

INTENT:
${JSON.stringify(intent, null, 2)}

SOLVER QUOTES:
${JSON.stringify(quotes, null, 2)}

Evaluate each quote on these criteria:
1. Whether the quoted price seems reasonable for the token pair
2. Flag suspiciously good quotes that may indicate sandwich attack or MEV extraction risk
3. Check if the slippage tolerance is dangerously high (>3% is caution, >5% is danger)
4. Assess whether gas estimates are realistic for the chain and operation
5. Assign each quote a risk rating: "safe", "caution", or "danger"

Respond ONLY with valid JSON matching this exact schema (no markdown, no explanation outside the JSON):
{
  "recommendation": "<one-line overall recommendation>",
  "quotes": [
    {
      "solver": "<solver name from the quote>",
      "riskRating": "safe" | "caution" | "danger",
      "riskNote": "<brief explanation of risk assessment>"
    }
  ]
}`;
}

function fallbackResult(quotes: Record<string, unknown>[]): RiskAnalysis {
  return {
    analyzed: false,
    recommendation: "Risk analysis unavailable — quotes returned without AI review.",
    quotes: quotes.map((q) => ({
      solver: (q.solver as string) || (q.name as string) || "unknown",
      riskRating: "unanalyzed" as RiskRating,
      riskNote: "Analysis skipped — no API key or service unavailable.",
    })),
  };
}

export async function analyzeRouteRisk(
  intent: Record<string, unknown>,
  quotes: Record<string, unknown>[],
): Promise<RiskAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn("[IntentGuard] ANTHROPIC_API_KEY not set — skipping risk analysis.");
    return fallbackResult(quotes);
  }

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: buildPrompt(intent, quotes),
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.warn("[IntentGuard] No text block in Claude response.");
      return fallbackResult(quotes);
    }

    let raw = textBlock.text.trim();
    // Strip markdown code fences if present (Claude sometimes wraps JSON in ```json ... ```)
    if (raw.startsWith("\`\`\`")) {
      raw = raw.replace(/^\`\`\`(?:json)?\n?/, "").replace(/\n?\`\`\`$/, "");
    }
    const parsed = JSON.parse(raw) as {
      recommendation: string;
      quotes: { solver: string; riskRating: string; riskNote: string }[];
    };

    const validRatings = new Set<RiskRating>(["safe", "caution", "danger"]);

    const enrichedQuotes: QuoteRisk[] = parsed.quotes.map((q) => ({
      solver: q.solver || "unknown",
      riskRating: validRatings.has(q.riskRating as RiskRating)
        ? (q.riskRating as RiskRating)
        : "caution",
      riskNote: q.riskNote || "No details provided.",
    }));

    return {
      analyzed: true,
      recommendation: parsed.recommendation || "No recommendation provided.",
      quotes: enrichedQuotes,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[IntentGuard] Risk analysis failed:", message);
    return fallbackResult(quotes);
  }
}
