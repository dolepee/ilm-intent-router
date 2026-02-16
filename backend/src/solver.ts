// solver.ts - Real token-price solver for the ILM Intent Router
// Fetches live prices from CoinGecko + DexScreener, caches 30s, per-solver profiles.

import { createHash } from "crypto";

export type IntentInput = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  maxSlippageBps: number;
  maxGasWei: string;
  deadline: number;
};

export type PriceMetadata = {
  source: "coingecko" | "dexscreener" | "fallback";
  timestamp: number;
  isStale: boolean;
  reliabilityScore: number; // 0-1: 1=live, 0.5=cached, 0.2=fallback
};

export type SolverQuote = {
  solver: string;
  expectedOut: string;
  expectedGasWei: string;
  confidence: number;
  score: number;
  valid: boolean;
  checks: { minOutPass: boolean; gasPass: boolean; slippagePass: boolean; priceReliable: boolean };
  impliedSlippageBps: number;
  priceSource: "live" | "fallback";
  priceMeta: { tokenIn: PriceMetadata; tokenOut: PriceMetadata };
  reason: string;
  route: string[];
  executionHash: string;
};

export type TokenInfo = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  priceUsd: number | null;
  source: "coingecko" | "dexscreener" | "fallback";
  logoUrl?: string;
};

const TOKEN_TO_CG: Record<string, string> = {
  weth: "ethereum", eth: "ethereum", usdc: "usd-coin", usdt: "tether",
  dai: "dai", wbtc: "wrapped-bitcoin", btc: "bitcoin", matic: "matic-network",
  sol: "solana", avax: "avalanche-2", bnb: "binancecoin", link: "chainlink",
  uni: "uniswap", aave: "aave", mkr: "maker", crv: "curve-dao-token",
  arb: "arbitrum", op: "optimism", steth: "staked-ether", cbeth: "coinbase-wrapped-staked-eth",
  aero: "aerodrome-finance", virtual: "virtual-protocol", degen: "degen-base",
};

function cgId(sym: string): string {
  return TOKEN_TO_CG[sym.toLowerCase()] ?? sym.toLowerCase();
}

function isContractAddress(input: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(input);
}

// Price cache (30s TTL)
interface CacheEntry { priceUsd: number; ts: number; source: "coingecko" | "dexscreener" | "fallback"; }
const CACHE_TTL = 30_000;
const STALE_THRESHOLD = 120_000; // 2 minutes
const cache = new Map<string, CacheEntry>();

function buildPriceMeta(entry: CacheEntry | null, fallbackUsed: boolean): PriceMetadata {
  if (!entry || fallbackUsed) {
    return { source: "fallback", timestamp: Date.now(), isStale: true, reliabilityScore: 0.2 };
  }
  const age = Date.now() - entry.ts;
  const isStale = age > STALE_THRESHOLD;
  const reliabilityScore = isStale ? 0.4 : (entry.source === "coingecko" ? 1.0 : 0.8);
  return { source: entry.source, timestamp: entry.ts, isStale, reliabilityScore };
}

// Token info cache for CA lookups
const tokenInfoCache = new Map<string, { info: TokenInfo; ts: number }>();

/**
 * Resolve a contract address to token info via DexScreener
 */
export async function resolveContractAddress(address: string): Promise<TokenInfo | null> {
  const key = address.toLowerCase();
  const cached = tokenInfoCache.get(key);
  if (cached && Date.now() - cached.ts < 60_000) return cached.info;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!res.ok) return null;
    const data = await res.json() as any;
    const pairs = data.pairs || [];
    if (pairs.length === 0) return null;

    // Find the pair with highest liquidity on Base chain (or any chain)
    const basePairs = pairs.filter((p: any) => p.chainId === "base");
    const bestPair = (basePairs.length > 0 ? basePairs : pairs)
      .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

    const isBaseToken = bestPair.baseToken?.address?.toLowerCase() === key;
    const tokenData = isBaseToken ? bestPair.baseToken : bestPair.quoteToken;
    const priceUsd = isBaseToken
      ? parseFloat(bestPair.priceUsd || "0")
      : (1 / parseFloat(bestPair.priceNative || "1")) * parseFloat(bestPair.priceUsd || "0");

    const info: TokenInfo = {
      symbol: tokenData?.symbol || "UNKNOWN",
      name: tokenData?.name || "Unknown Token",
      address: address,
      decimals: 18, // default, frontend can override
      priceUsd: priceUsd > 0 ? priceUsd : null,
      source: "dexscreener",
      logoUrl: bestPair.info?.imageUrl,
    };

    tokenInfoCache.set(key, { info, ts: Date.now() });
    return info;
  } catch {
    return null;
  }
}

/**
 * Search tokens by name/symbol via DexScreener
 */
export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!res.ok) return [];
    const data = await res.json() as any;
    const pairs = data.pairs || [];

    // Filter to Base chain only
    const basePairs = pairs.filter((p: any) => p.chainId === "base");

    // Deduplicate by token address
    const seen = new Map<string, TokenInfo>();
    for (const pair of basePairs) {
      for (const side of ["baseToken", "quoteToken"] as const) {
        const token = pair[side];
        if (!token?.address) continue;
        // Only include valid EVM addresses
        if (!/^0x[a-fA-F0-9]{40}$/.test(token.address)) continue;
        const addr = token.address.toLowerCase();
        if (seen.has(addr)) continue;

        const isBase = side === "baseToken";
        const priceUsd = isBase
          ? parseFloat(pair.priceUsd || "0")
          : 0; // skip quote token price calc for search

        seen.set(addr, {
          symbol: token.symbol || "???",
          name: token.name || "Unknown",
          address: token.address,
          decimals: token.decimals ?? 18,
          priceUsd: priceUsd > 0 ? priceUsd : null,
          source: "dexscreener",
          logoUrl: pair.info?.imageUrl,
        });
      }
      if (seen.size >= 10) break; // limit results
    }

    return Array.from(seen.values());
  } catch {
    return [];
  }
}

async function fetchPair(tIn: string, tOut: string): Promise<{ priceIn: number | null; priceOut: number | null }> {
  // If inputs are contract addresses, use DexScreener
  if (isContractAddress(tIn) || isContractAddress(tOut)) {
    let priceIn: number | null = null;
    let priceOut: number | null = null;

    if (isContractAddress(tIn)) {
      const info = await resolveContractAddress(tIn);
      priceIn = info?.priceUsd ?? null;
    } else {
      priceIn = await fetchSinglePrice(tIn);
    }

    if (isContractAddress(tOut)) {
      const info = await resolveContractAddress(tOut);
      priceOut = info?.priceUsd ?? null;
    } else {
      priceOut = await fetchSinglePrice(tOut);
    }

    return { priceIn, priceOut };
  }

  // Standard CoinGecko flow for known symbols
  const idIn = cgId(tIn), idOut = cgId(tOut);
  const now = Date.now();
  const cIn = cache.get(idIn), cOut = cache.get(idOut);
  if (cIn && now - cIn.ts < CACHE_TTL && cOut && now - cOut.ts < CACHE_TTL) {
    return { priceIn: cIn.priceUsd, priceOut: cOut.priceUsd };
  }
  // Primary: CoinGecko
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idIn)},${encodeURIComponent(idOut)}&vs_currencies=usd`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const d = (await res.json()) as Record<string, { usd?: number }>;
      const pIn = d[idIn]?.usd ?? null, pOut = d[idOut]?.usd ?? null;
      if (pIn !== null) cache.set(idIn, { priceUsd: pIn, ts: Date.now(), source: "coingecko" });
      if (pOut !== null) cache.set(idOut, { priceUsd: pOut, ts: Date.now(), source: "coingecko" });
      if (pIn !== null && pOut !== null) return { priceIn: pIn, priceOut: pOut };
    }
  } catch {}
  // Fallback: DexScreener for any missing prices
  let priceIn = cIn?.priceUsd ?? null;
  let priceOut = cOut?.priceUsd ?? null;
  if (priceIn === null) priceIn = await fetchPriceFromDexScreener(tIn);
  if (priceOut === null) priceOut = await fetchPriceFromDexScreener(tOut);
  if (priceIn !== null) cache.set(idIn, { priceUsd: priceIn, ts: Date.now(), source: "dexscreener" });
  if (priceOut !== null) cache.set(idOut, { priceUsd: priceOut, ts: Date.now(), source: "dexscreener" });
  return { priceIn, priceOut };
}

async function fetchPriceFromDexScreener(sym: string): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(sym)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const pairs = data.pairs || [];
    const match = pairs.find((p: any) =>
      p.chainId === "base" &&
      p.baseToken?.symbol?.toLowerCase() === sym.toLowerCase()
    ) || pairs.find((p: any) =>
      p.baseToken?.symbol?.toLowerCase() === sym.toLowerCase()
    );
    if (match) return parseFloat(match.priceUsd || "0") || null;
    return null;
  } catch {
    return null;
  }
}

async function fetchSinglePrice(sym: string): Promise<number | null> {
  const id = cgId(sym);
  const now = Date.now();
  const c = cache.get(id);
  if (c && now - c.ts < CACHE_TTL) return c.priceUsd;
  // Primary: CoinGecko
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const d = (await res.json()) as Record<string, { usd?: number }>;
      const p = d[id]?.usd ?? null;
      if (p !== null) { cache.set(id, { priceUsd: p, ts: Date.now(), source: "coingecko" }); return p; }
    }
  } catch {}
  // Fallback: DexScreener
  const dexPrice = await fetchPriceFromDexScreener(sym);
  if (dexPrice !== null) {
    cache.set(id, { priceUsd: dexPrice, ts: Date.now(), source: "dexscreener" });
    return dexPrice;
  }
  return c?.priceUsd ?? null;
}

// Solver profiles
interface Profile {
  label: string; priceEdgeMean: number; priceEdgeStd: number;
  baseGas: number; gasVar: number; baseConf: number; route: string[];
}
const PROFILES: Record<string, Profile> = {
  "solver-alpha": { label: "Speed-optimized", priceEdgeMean: 0.998, priceEdgeStd: 0.001, baseGas: 2.1e13, gasVar: 3e12, baseConf: 0.88, route: ["UniV3-Direct"] },
  "solver-beta":  { label: "Price-optimized", priceEdgeMean: 1.003, priceEdgeStd: 0.002, baseGas: 3.8e13, gasVar: 6e12, baseConf: 0.82, route: ["UniV3-Pool", "CurveTriCrypto", "BalancerWeighted"] },
  "solver-gamma": { label: "Balanced",        priceEdgeMean: 1.001, priceEdgeStd: 0.0015, baseGas: 2.8e13, gasVar: 4e12, baseConf: 0.85, route: ["UniV3-Pool", "SushiV2"] },
};
const DEFAULT_PROFILE: Profile = { label: "Unknown", priceEdgeMean: 0.999, priceEdgeStd: 0.002, baseGas: 3e13, gasVar: 5e12, baseConf: 0.80, route: ["GenericAMM"] };

// Seeded PRNG (FNV-1a)
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

// Fallback prices when CoinGecko is down
const FALLBACK: Record<string, number> = {
  ethereum: 3200, "usd-coin": 1, tether: 1, dai: 1, "wrapped-bitcoin": 95000,
  bitcoin: 95000, solana: 170, "avalanche-2": 28, binancecoin: 600,
  chainlink: 16, uniswap: 8, aave: 260, maker: 1500, arbitrum: 0.8, optimism: 1.5,
};
function fallback(sym: string): number { return FALLBACK[cgId(sym)] ?? 1; }

export async function scoreIntent(intent: IntentInput, solver = "solver-alpha"): Promise<SolverQuote> {
  const p = PROFILES[solver] ?? DEFAULT_PROFILE;
  const bucket = Math.floor(Date.now() / 30_000);
  const rand = seededRandom(`${solver}:${intent.tokenIn}:${intent.tokenOut}:${intent.amountIn}:${bucket}`);

  const { priceIn: rawPriceIn, priceOut: rawPriceOut } = await fetchPair(intent.tokenIn, intent.tokenOut);

  // Sanity check: reject live prices that deviate >20x from known fallback
  const fbIn = fallback(intent.tokenIn), fbOut = fallback(intent.tokenOut);
  const saneIn = rawPriceIn !== null && fbIn > 0 && (rawPriceIn / fbIn > 20 || rawPriceIn / fbIn < 0.05) ? null : rawPriceIn;
  const saneOut = rawPriceOut !== null && fbOut > 0 && (rawPriceOut / fbOut > 20 || rawPriceOut / fbOut < 0.05) ? null : rawPriceOut;

  const usedFallbackIn = saneIn === null;
  const usedFallbackOut = saneOut === null;
  const pIn = saneIn ?? fbIn;
  const pOut = saneOut ?? fbOut;

  // Build price metadata per token
  const idIn = isContractAddress(intent.tokenIn) ? intent.tokenIn.toLowerCase() : cgId(intent.tokenIn);
  const idOut = isContractAddress(intent.tokenOut) ? intent.tokenOut.toLowerCase() : cgId(intent.tokenOut);
  const metaIn = buildPriceMeta(cache.get(idIn) ?? null, usedFallbackIn);
  const metaOut = buildPriceMeta(cache.get(idOut) ?? null, usedFallbackOut);

  const amountIn = Number(intent.amountIn);
  const fairOut = pOut > 0 ? (amountIn * pIn) / pOut : amountIn;

  // Box-Muller for normal distribution
  const u1 = Math.max(1e-10, rand()), u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const edge = p.priceEdgeMean + z * p.priceEdgeStd;
  const expectedOut = fairOut * edge;

  const gasJitter = rand() * p.gasVar;
  const expectedGasWei = Math.floor(p.baseGas + gasJitter);

  const minOutPass = expectedOut >= Number(intent.minAmountOut);
  const gasPass = expectedGasWei <= Number(intent.maxGasWei);

  // Slippage enforcement: implied slippage vs fair value
  const impliedSlippageBps = fairOut > 0
    ? Math.round(Math.max(0, (1 - expectedOut / fairOut)) * 10000)
    : 0;
  const slippagePass = impliedSlippageBps <= intent.maxSlippageBps;

  // Price reliability: reject fallback-only pricing from being marked fully valid
  const priceReliable = metaIn.reliabilityScore >= 0.5 && metaOut.reliabilityScore >= 0.5;
  const valid = minOutPass && gasPass && slippagePass && priceReliable;

  const dataBonus = (saneIn !== null && saneOut !== null) ? 0.05 : -0.05;
  const confidence = Math.min(0.99, Math.max(0.5, p.baseConf + dataBonus + (rand() - 0.5) * 0.06));

  // Decomposed scoring — no saturation, meaningful differentiation
  const minOut = Number(intent.minAmountOut);
  const maxGas = Number(intent.maxGasWei);

  // Price quality (50%): log-scaled improvement over minimum
  const priceRatio = minOut > 0 ? expectedOut / minOut : 1;
  const priceScore = minOutPass
    ? 0.5 + Math.min(0.5, Math.log1p(Math.max(0, priceRatio - 1) * 10) * 0.25)
    : Math.max(0, 0.3 * priceRatio);

  // Gas efficiency (30%): headroom below max gas
  const gasScore = maxGas > 0 && gasPass
    ? 0.5 + 0.5 * (1 - expectedGasWei / maxGas)
    : (gasPass ? 0.5 : 0.1);

  // Confidence (20%)
  const confScore = confidence;

  const score = Math.max(0, Math.min(0.99, priceScore * 0.50 + gasScore * 0.30 + confScore * 0.20));

  const priceSource: "live" | "fallback" = (saneIn !== null && saneOut !== null) ? "live" : "fallback";
  let reason: string;
  if (valid) {
    reason = `Meets all constraints (${p.label}, ${priceSource} prices, edge ${((edge - 1) * 100).toFixed(2)}%, slippage ${impliedSlippageBps}bps)`;
  } else {
    const fails: string[] = [];
    if (!minOutPass) fails.push(`min-output (expected ${expectedOut.toFixed(6)} < ${intent.minAmountOut})`);
    if (!gasPass) fails.push(`max-gas (est ${expectedGasWei} > ${intent.maxGasWei})`);
    if (!slippagePass) fails.push(`slippage (implied ${impliedSlippageBps}bps > max ${intent.maxSlippageBps}bps)`);
    if (!priceReliable) fails.push(`price-reliability (in=${metaIn.reliabilityScore.toFixed(1)}, out=${metaOut.reliabilityScore.toFixed(1)})`);
    reason = `Fails: ${fails.join(', ')}`;
  }

  // Cryptographic execution hash: SHA-256 of canonicalized quote payload
  const canonicalPayload = JSON.stringify({
    solver, tokenIn: intent.tokenIn, tokenOut: intent.tokenOut,
    amountIn: intent.amountIn, expectedOut: expectedOut.toFixed(8),
    expectedGasWei: String(expectedGasWei), timestamp: bucket,
  });
  const executionHash = "0x" + createHash("sha256").update(canonicalPayload).digest("hex");

  return {
    solver, expectedOut: expectedOut.toFixed(6), expectedGasWei: String(expectedGasWei),
    confidence: Number(confidence.toFixed(2)), score: Number(score.toFixed(3)), valid,
    checks: { minOutPass, gasPass, slippagePass, priceReliable }, impliedSlippageBps, priceSource,
    priceMeta: { tokenIn: metaIn, tokenOut: metaOut },
    reason, route: p.route, executionHash,
  };
}
