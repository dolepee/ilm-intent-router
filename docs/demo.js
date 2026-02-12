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
const ROUTER_ABI = [
  "function createIntent(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 maxSlippageBps, uint256 maxGasWei, uint64 deadline) external returns (uint256)",
  "event IntentCreated(uint256 indexed intentId, address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 deadline)",
];

let provider = null, signer = null, walletAddr = null, lastBest = null;

// API URL persistence
function getApiFromQuery() { try { return new URL(window.location.href).searchParams.get("api") || ""; } catch { return ""; } }
const apiInput = document.getElementById("apiBase");
apiInput.value = getApiFromQuery() || localStorage.getItem("ilm_api") || "https://ilm-intent-router-api.onrender.com";
apiInput.addEventListener("change", () => localStorage.setItem("ilm_api", apiInput.value.trim().replace(/\/$/,"")));

function v(id) { return document.getElementById(id).value.trim(); }

// Wallet
async function connectWallet() {
  if (!window.ethereum) { alert("Install MetaMask to connect"); return; }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    // Switch to Base Sepolia
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: BASE_SEPOLIA_ID }]);
    } catch (e) {
      if (e.code === 4902) {
        await provider.send("wallet_addEthereumChain", [{
          chainId: BASE_SEPOLIA_ID, chainName: "Base Sepolia",
          rpcUrls: ["https://sepolia.base.org"],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: ["https://sepolia.basescan.org"],
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
  const apiBase = apiInput.value.trim().replace(/\/$/,"");
  if (!apiBase) { alert("Enter API Base URL first"); return; }
  const btn = document.getElementById("runBtn");
  btn.disabled = true; btn.textContent = "Running...";

  const now = Math.floor(Date.now() / 1000);
  const intent = {
    tokenIn: v("tokenIn"), tokenOut: v("tokenOut"), amountIn: v("amountIn"),
    minAmountOut: v("minAmountOut"), maxSlippageBps: Number(v("maxSlippageBps")),
    maxGasWei: v("maxGasWei"), deadline: now + 3600,
  };

  try {
    const r = await fetch(`${apiBase}/compete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, solvers: [{ name: "solver-alpha" }, { name: "solver-beta" }, { name: "solver-gamma" }] }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);

    lastBest = data.best;
    renderResults(data);
    document.getElementById("resultsSection").classList.add("show");
    document.getElementById("emptyState").style.display = "none";
    if (signer) document.getElementById("createBtn").disabled = false;
  } catch (e) {
    alert("Competition failed: " + e.message);
  }
  btn.disabled = false; btn.textContent = "Run Solver Competition";
}

function scoreColor(s) { return s >= 0.8 ? "var(--green)" : s >= 0.5 ? "var(--yellow)" : "var(--red)"; }

function renderResults(data) {
  const container = document.getElementById("solverCards");
  container.innerHTML = "";
  const bestSolver = data.best?.solver;

  const labels = { "solver-alpha": "Speed-optimized", "solver-beta": "Price-optimized", "solver-gamma": "Balanced" };

  (data.quotes || []).forEach((q, i) => {
    const isWinner = q.solver === bestSolver;
    const card = document.createElement("div");
    card.className = "solver-card animate" + (isWinner ? " winner" : "");
    card.style.animationDelay = `${i * 0.1}s`;
    const pct = Math.round(q.score * 100);
    const col = scoreColor(q.score);
    card.innerHTML = `
      <div class="solver-header">
        <div><div class="solver-name">${q.solver}</div><div class="solver-label">${labels[q.solver] || ""}</div></div>
        <div class="score-badge" style="color:${col}">${pct}</div>
      </div>
      <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%;background:${col}"></div></div>
      <div class="stats-row">
        <div class="stat"><div class="stat-val">${Number(q.expectedOut).toFixed(4)}</div><div class="stat-label">Expected Out</div></div>
        <div class="stat"><div class="stat-val">${(Number(q.expectedGasWei)/1e12).toFixed(1)}T</div><div class="stat-label">Gas (wei)</div></div>
        <div class="stat"><div class="stat-val">${(q.confidence * 100).toFixed(0)}%</div><div class="stat-label">Confidence</div></div>
        <div class="stat"><div class="stat-val">${q.route?.join(" → ") || "—"}</div><div class="stat-label">Route</div></div>
      </div>
      <div class="checks">
        <span class="check ${q.checks?.minOutPass ? 'pass' : 'fail'}">${q.checks?.minOutPass ? '✓' : '✗'} Min Output</span>
        <span class="check ${q.checks?.gasPass ? 'pass' : 'fail'}">${q.checks?.gasPass ? '✓' : '✗'} Max Gas</span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-dim)">${q.reason || ""}</div>
    `;
    container.appendChild(card);
  });

  // Risk analysis
  const riskSection = document.getElementById("riskSection");
  if (data.riskAnalysis) {
    riskSection.style.display = "block";
    document.getElementById("riskRec").textContent = data.riskAnalysis.recommendation || "No recommendation";
    const items = document.getElementById("riskItems");
    items.innerHTML = "";
    (data.riskAnalysis.quotes || []).forEach(rq => {
      const el = document.createElement("div");
      el.className = "risk-item";
      el.innerHTML = `<span>${rq.solver}: ${rq.riskNote || "—"}</span><span class="risk-badge ${rq.riskRating}">${rq.riskRating}</span>`;
      items.appendChild(el);
    });
  } else {
    riskSection.style.display = "none";
  }
}

// Onchain intent creation
async function createIntentOnchain() {
  if (!signer || !lastBest) { alert("Connect wallet and run competition first"); return; }
  const btn = document.getElementById("createBtn");
  const txBox = document.getElementById("txBox");
  btn.disabled = true; btn.textContent = "Submitting...";

  try {
    const tIn = TOKEN_MAP[v("tokenIn")] || TOKEN_MAP.WETH;
    const tOut = TOKEN_MAP[v("tokenOut")] || TOKEN_MAP.USDC;
    const amtIn = ethers.parseEther(v("amountIn"));
    const minOut = ethers.parseEther(v("minAmountOut"));
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const router = new ethers.Contract(CONTRACT_ADDR, ROUTER_ABI, signer);

    // First approve tokenIn
    const erc20Abi = ["function approve(address,uint256) returns (bool)"];
    const tokenContract = new ethers.Contract(tIn, erc20Abi, signer);
    txBox.innerHTML = "Approving token..."; txBox.classList.add("show");
    const approveTx = await tokenContract.approve(CONTRACT_ADDR, amtIn);
    await approveTx.wait();

    txBox.innerHTML = "Creating intent onchain...";
    const tx = await router.createIntent(tIn, tOut, amtIn, minOut, Number(v("maxSlippageBps")), BigInt(v("maxGasWei")), deadline);
    txBox.innerHTML = `Tx sent: <a href="https://sepolia.basescan.org/tx/${tx.hash}" target="_blank">${tx.hash.slice(0,18)}...</a>`;

    const receipt = await tx.wait();
    txBox.innerHTML = `Intent created! Tx: <a href="https://sepolia.basescan.org/tx/${tx.hash}" target="_blank">${tx.hash.slice(0,18)}...</a> (block ${receipt.blockNumber})`;
  } catch (e) {
    txBox.innerHTML = `Error: ${e.reason || e.message}`;
    txBox.classList.add("show");
  }
  btn.disabled = false; btn.textContent = "Create Intent Onchain (Base Sepolia)";
}
