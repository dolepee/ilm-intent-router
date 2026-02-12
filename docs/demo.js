/* Intent Guard — Demo JS */
const CONTRACT_ADDR = "0x759415bE6b7Ef0C58897bE68E245cE5de618F57E";
const BASE_SEPOLIA_ID = "0x14a34"; // 84532
const TOKEN_MAP = {
  WETH: "0xf1cAE578D644F4e2F487B464fEbCc02A70B9ca03",
  USDC: "0x2e0a4169afdcb3Aa04439Ac9E9C045b02ef5cf28",
  USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  DAI:  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  WBTC: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
};
const TOKEN_DECIMALS = { WETH: 18, USDC: 6, USDT: 6, DAI: 18, WBTC: 8 };

// Approximate USD prices for smart defaults
const TOKEN_USD = { WETH: 2000, USDC: 1, USDT: 1, DAI: 1, WBTC: 95000 };

const ROUTER_ABI = [
  "function createIntent(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 maxSlippageBps, uint256 maxGasWei, uint64 deadline) external returns (uint256)",
  "event IntentCreated(uint256 indexed intentId, address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 deadline)",
];

let provider = null, signer = null, walletAddr = null, lastBest = null;

// API URL — hardcoded default, hidden from user
const API_BASE = "https://ilm-intent-router-api.onrender.com";
function getApi() {
  const q = new URL(window.location.href).searchParams.get("api");
  return q || localStorage.getItem("ilm_api") || API_BASE;
}

// Toggle advanced config
function toggleConfig() {
  const el = document.getElementById("apiConfigBody");
  const arrow = document.getElementById("configArrow");
  if (el.style.display === "none") { el.style.display = "block"; arrow.textContent = "\u25B2"; }
  else { el.style.display = "none"; arrow.textContent = "\u25BC"; }
}

function v(id) { return document.getElementById(id).value.trim(); }

// Smart defaults: update minAmountOut when token pair or amount changes
function updateSmartDefault() {
  const tIn = v("tokenIn"), tOut = v("tokenOut"), amtIn = parseFloat(v("amountIn")) || 1;
  const usdIn = TOKEN_USD[tIn] || 1, usdOut = TOKEN_USD[tOut] || 1;
  const fairOut = (amtIn * usdIn) / usdOut;
  const minOut = (fairOut * 0.95).toFixed(usdOut >= 100 ? 0 : (usdOut === 1 ? 2 : 6));
  document.getElementById("minAmountOut").value = minOut;
}

// Wallet
async function connectWallet() {
  if (typeof window === "undefined" || typeof window.ethereum === "undefined") { alert("Install MetaMask to connect"); return; }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: BASE_SEPOLIA_ID }]);
    } catch (e) {
      if (e.code === 4902) {
        await provider.send("wallet_addEthereumChain", [{
          chainId: BASE_SEPOLIA_ID, chainName: "Base Sepolia",
          rpcUrls: ["https://sepolia.base.org"],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: ["https://base-sepolia.blockscout.com"],
        }]);
      }
    }
    signer = await provider.getSigner();
    walletAddr = await signer.getAddress();
    document.getElementById("walletBtn").textContent = walletAddr.slice(0,6) + "..." + walletAddr.slice(-4);
    document.getElementById("walletBtn").classList.add("connected");
    document.getElementById("netPill").style.display = "inline-flex";
    if (lastBest) document.getElementById("createBtn").disabled = false;
  } catch (e) { console.error(e); alert("Wallet connection failed: " + e.message); }
}

// Competition
async function runCompetition() {
  const apiBase = getApi();
  const btn = document.getElementById("runBtn");
  const statusEl = document.getElementById("competitionStatus");
  btn.disabled = true;

  // Step 1: Fetching quotes
  statusEl.innerHTML = "<span class=\"status-dot pulse\"></span> Fetching solver quotes...";
  statusEl.style.display = "flex";

  const now = Math.floor(Date.now() / 1000);
  const intent = {
    tokenIn: v("tokenIn"), tokenOut: v("tokenOut"), amountIn: v("amountIn"),
    minAmountOut: v("minAmountOut"), maxSlippageBps: Number(v("maxSlippageBps")),
    maxGasWei: v("maxGasWei"), deadline: now + 3600,
  };

  try {
    // Step 2: AI analyzing
    statusEl.innerHTML = "<span class=\"status-dot pulse ai\"></span> AI analyzing quotes for MEV risk, price anomalies...";

    const r = await fetch(apiBase + "/compete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, solvers: [{ name: "solver-alpha" }, { name: "solver-beta" }, { name: "solver-gamma" }] }),
    });
    const data = await r.json();
    if (r.ok === false) throw new Error(data.error || "HTTP " + r.status);

    lastBest = data.best;
    statusEl.innerHTML = "<span class=\"status-dot done\"></span> Analysis complete";
    setTimeout(() => { statusEl.style.display = "none"; }, 2000);

    renderResults(data);
    document.getElementById("resultsSection").classList.add("show");
    document.getElementById("emptyState").style.display = "none";
    if (signer) document.getElementById("createBtn").disabled = false;
  } catch (e) {
    statusEl.innerHTML = "<span class=\"status-dot fail\"></span> " + e.message;
    setTimeout(() => { statusEl.style.display = "none"; }, 5000);
  }
  btn.disabled = false;
}

function scoreColor(s) { return s >= 0.8 ? "var(--green)" : s >= 0.5 ? "var(--yellow)" : "var(--red)"; }
function safeScore(s) { return (typeof s === "number" && isFinite(s)) ? s : 0.5; }

function renderResults(data) {
  const container = document.getElementById("solverCards");
  container.innerHTML = "";
  const bestSolver = data.best?.solver;
  const labels = { "solver-alpha": "Speed-optimized", "solver-beta": "Price-optimized", "solver-gamma": "Balanced" };

  // Build risk map
  const riskMap = {};
  if (data.riskAnalysis && data.riskAnalysis.quotes) {
    data.riskAnalysis.quotes.forEach(rq => { riskMap[rq.solver] = rq.riskRating; });
  }

  (data.quotes || []).forEach((q, i) => {
    const isWinner = q.solver === bestSolver;
    const risk = riskMap[q.solver] || "unanalyzed";
    const card = document.createElement("div");
    card.className = "solver-card animate" + (isWinner ? " winner" : "") + (risk === "danger" ? " danger-card" : "");
    card.style.animationDelay = i * 0.1 + "s";
    const sc = safeScore(q.score);
    const pct = Math.round(sc * 100);
    const col = scoreColor(sc);
    card.innerHTML =
      "<div class=\"solver-header\">" +
        "<div><div class=\"solver-name\">" + q.solver + "</div><div class=\"solver-label\">" + (labels[q.solver] || "") + "</div></div>" +
        "<div style=\"display:flex;align-items:center;gap:8px\"><span class=\"risk-badge " + risk + "\">" + risk + "</span><div class=\"score-badge\" style=\"color:" + col + "\">" + pct + "</div></div>" +
      "</div>" +
      "<div class=\"score-bar-wrap\"><div class=\"score-bar\" style=\"width:" + pct + "%;background:" + col + "\"></div></div>" +
      "<div class=\"stats-row\">" +
        "<div class=\"stat\"><div class=\"stat-val\">" + Number(q.expectedOut).toFixed(2) + "</div><div class=\"stat-label\">Expected Out</div></div>" +
        "<div class=\"stat\"><div class=\"stat-val\">" + (Number(q.expectedGasWei)/1e12).toFixed(1) + "T</div><div class=\"stat-label\">Gas (wei)</div></div>" +
        "<div class=\"stat\"><div class=\"stat-val\">" + (q.confidence * 100).toFixed(0) + "%</div><div class=\"stat-label\">Confidence</div></div>" +
        "<div class=\"stat\"><div class=\"stat-val\">" + (q.route ? q.route.join(" > ") : "\u2014") + "</div><div class=\"stat-label\">Route</div></div>" +
      "</div>" +
      "<div class=\"checks\">" +
        "<span class=\"check " + (q.checks && q.checks.minOutPass ? "pass" : "fail") + "\">" + (q.checks && q.checks.minOutPass ? "\u2713" : "\u2717") + " Min Output</span>" +
        "<span class=\"check " + (q.checks && q.checks.gasPass ? "pass" : "fail") + "\">" + (q.checks && q.checks.gasPass ? "\u2713" : "\u2717") + " Max Gas</span>" +
      "</div>" +
      "<div style=\"margin-top:8px;font-size:12px;color:var(--text-dim)\">" + (q.reason || "") + "</div>";
    container.appendChild(card);
  });

  // AI Risk analysis section
  const riskSection = document.getElementById("riskSection");
  if (data.riskAnalysis && data.riskAnalysis.analyzed) {
    riskSection.style.display = "block";
    document.getElementById("riskRec").textContent = data.riskAnalysis.recommendation || "No recommendation";
    const items = document.getElementById("riskItems");
    items.innerHTML = "";
    (data.riskAnalysis.quotes || []).forEach(function(rq) {
      var el = document.createElement("div");
      el.className = "risk-item";
      el.innerHTML = "<span class=\"risk-note\">" + rq.solver + ": " + (rq.riskNote || "\u2014") + "</span><span class=\"risk-badge " + rq.riskRating + "\">" + rq.riskRating + "</span>";
      items.appendChild(el);
    });
  } else {
    riskSection.style.display = "none";
  }
}

// Onchain intent creation
async function createIntentOnchain() {
  if (signer === null || lastBest === null) { alert("Connect wallet and run competition first"); return; }
  var btn = document.getElementById("createBtn");
  var txBox = document.getElementById("txBox");
  btn.disabled = true; btn.textContent = "Submitting...";

  try {
    var tIn = TOKEN_MAP[v("tokenIn")] || TOKEN_MAP.WETH;
    var tOut = TOKEN_MAP[v("tokenOut")] || TOKEN_MAP.USDC;
    var decimalsIn = TOKEN_DECIMALS[v("tokenIn")] || 18;
    var amtIn = ethers.parseUnits(v("amountIn"), decimalsIn);
    var decimalsOut = TOKEN_DECIMALS[v("tokenOut")] || 18;
    var minOut = ethers.parseUnits(v("minAmountOut"), decimalsOut);
    var deadline = Math.floor(Date.now() / 1000) + 3600;

    var router = new ethers.Contract(CONTRACT_ADDR, ROUTER_ABI, signer);

    // Approve
    var erc20Abi = ["function approve(address,uint256) returns (bool)"];
    var tokenContract = new ethers.Contract(tIn, erc20Abi, signer);
    txBox.innerHTML = "<span class=\"status-dot pulse\"></span> Approving token..."; txBox.classList.add("show");
    var approveTx = await tokenContract.approve(CONTRACT_ADDR, amtIn);
    await approveTx.wait();

    txBox.innerHTML = "<span class=\"status-dot pulse\"></span> Creating intent onchain...";
    var tx = await router.createIntent(tIn, tOut, amtIn, minOut, Number(v("maxSlippageBps")), BigInt(v("maxGasWei")), deadline);
    txBox.innerHTML = "Tx sent: <a href=\"https://base-sepolia.blockscout.com/tx/" + tx.hash + "\" target=\"_blank\">" + tx.hash.slice(0,18) + "...</a>";

    var receipt = await tx.wait();
    txBox.innerHTML = "\u2705 Intent created! <a href=\"https://base-sepolia.blockscout.com/tx/" + tx.hash + "\" target=\"_blank\">" + tx.hash.slice(0,18) + "...</a> (block " + receipt.blockNumber + ")";
  } catch (e) {
    txBox.innerHTML = "\u274C Error: " + (e.reason || e.message);
    txBox.classList.add("show");
  }
  btn.disabled = false; btn.textContent = "Create Intent Onchain (Base Sepolia)";
}

// Init: set smart defaults on load and on change
document.addEventListener("DOMContentLoaded", function() {
  updateSmartDefault();
  ["tokenIn","tokenOut","amountIn"].forEach(function(id) {
    document.getElementById(id).addEventListener("change", updateSmartDefault);
    document.getElementById(id).addEventListener("input", updateSmartDefault);
  });
});
