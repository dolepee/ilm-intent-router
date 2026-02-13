/* Intent Guard — Demo JS v2 (token search + swap-style UI) */

const CONTRACT_ADDR = "0x759415bE6b7Ef0C58897bE68E245cE5de618F57E";
const BASE_SEPOLIA_ID = "0x14a34"; // 84532

// Preset tokens (known, with demo addresses for Base Sepolia onchain)
const PRESET_TOKENS = [
  { symbol: "WETH", name: "Wrapped Ether", address: "0xf1cAE578D644F4e2F487B464fEbCc02A70B9ca03", decimals: 18, priceUsd: 2000 },
  { symbol: "USDC", name: "USD Coin", address: "0x2e0a4169afdcb3Aa04439Ac9E9C045b02ef5cf28", decimals: 6, priceUsd: 1 },
  { symbol: "USDT", name: "Tether USD", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, priceUsd: 1 },
  { symbol: "DAI",  name: "Dai Stablecoin", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, priceUsd: 1 },
  { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8, priceUsd: 95000 },
];

const ROUTER_ABI = [
  "function createIntent(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 maxSlippageBps, uint256 maxGasWei, uint64 deadline) external returns (uint256)",
  "event IntentCreated(uint256 indexed intentId, address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 deadline)",
];

let provider = null, signer = null, walletAddr = null, lastBest = null;

// Selected tokens state
let selectedTokenIn = { ...PRESET_TOKENS[0] };  // WETH
let selectedTokenOut = { ...PRESET_TOKENS[1] };  // USDC
let activeModalSide = "in"; // "in" or "out"
let searchTimeout = null;

// API
const API_BASE = "https://ilm-intent-router-api.onrender.com";
function getApi() {
  const q = new URL(window.location.href).searchParams.get("api");
  return q || localStorage.getItem("ilm_api") || API_BASE;
}

function toggleConfig() {
  const el = document.getElementById("apiConfigBody");
  const arrow = document.getElementById("configArrow");
  if (el.style.display === "none") { el.style.display = "block"; arrow.textContent = "\u25B2"; }
  else { el.style.display = "none"; arrow.textContent = "\u25BC"; }
}

function v(id) { return document.getElementById(id).value.trim(); }

// ============================================================================
// TOKEN SELECTOR
// ============================================================================

function updateTokenDisplay() {
  document.getElementById("tokenInSym").textContent = selectedTokenIn.symbol;
  document.getElementById("tokenOutSym").textContent = selectedTokenOut.symbol;
  document.getElementById("tokenInIcon").textContent = selectedTokenIn.symbol.charAt(0);
  document.getElementById("tokenOutIcon").textContent = selectedTokenOut.symbol.charAt(0);
  updateSmartDefault();
}

function updateSmartDefault() {
  var amtIn = parseFloat(v("amountIn")) || 1;
  var pIn = selectedTokenIn.priceUsd || 1;
  var pOut = selectedTokenOut.priceUsd || 1;
  var fairOut = (amtIn * pIn) / pOut;
  var minOut = fairOut * 0.95;
  document.getElementById("minAmountOut").value = pOut >= 100 ? minOut.toFixed(0) : (pOut === 1 ? minOut.toFixed(2) : minOut.toFixed(6));

  // USD value hints
  var usdIn = amtIn * pIn;
  document.getElementById("usdIn").textContent = pIn > 0 ? "~$" + usdIn.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
  var outAmt = parseFloat(v("minAmountOut")) || 0;
  var usdOut = outAmt * pOut;
  document.getElementById("usdOut").textContent = pOut > 0 ? "~$" + usdOut.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
}

function swapTokens() {
  var tmp = { ...selectedTokenIn };
  selectedTokenIn = { ...selectedTokenOut };
  selectedTokenOut = tmp;
  updateTokenDisplay();
}

// ============================================================================
// TOKEN SEARCH MODAL
// ============================================================================

function openTokenModal(side) {
  activeModalSide = side;
  var modal = document.getElementById("tokenModal");
  var search = document.getElementById("tokenSearch");
  modal.classList.add("show");
  search.value = "";
  search.focus();
  renderPresetChips();
  renderTokenList(PRESET_TOKENS);
}

function closeTokenModal(e) {
  if (e && e.target !== document.getElementById("tokenModal")) return;
  document.getElementById("tokenModal").classList.remove("show");
}

function renderPresetChips() {
  var container = document.getElementById("presetChips");
  container.innerHTML = "";
  PRESET_TOKENS.forEach(function(t) {
    var chip = document.createElement("div");
    chip.className = "preset-chip";
    chip.textContent = t.symbol;
    chip.onclick = function() { selectToken(t); };
    container.appendChild(chip);
  });
}

function renderTokenList(tokens, isLoading, isEmpty) {
  var list = document.getElementById("tokenList");
  list.innerHTML = "";

  if (isLoading) {
    list.innerHTML = '<div class="modal-loading">Searching...</div>';
    return;
  }
  if (isEmpty) {
    list.innerHTML = '<div class="modal-empty">No tokens found. Try a different search or paste a contract address.</div>';
    return;
  }

  tokens.forEach(function(t) {
    var opt = document.createElement("div");
    opt.className = "token-option";
    var iconHtml = t.logoUrl
      ? '<img src="' + t.logoUrl + '" onerror="this.parentNode.textContent=\'' + t.symbol.charAt(0) + '\'" />'
      : t.symbol.charAt(0);
    var priceHtml = t.priceUsd ? "$" + formatPrice(t.priceUsd) : "";
    var addrHtml = t.address && /^0x/.test(t.address) ? '<div class="t-addr">' + t.address.slice(0, 6) + "..." + t.address.slice(-4) + '</div>' : "";

    opt.innerHTML =
      '<div class="t-icon">' + iconHtml + '</div>' +
      '<div class="t-info"><div class="t-sym">' + t.symbol + '</div><div class="t-name">' + (t.name || "") + '</div>' + addrHtml + '</div>' +
      '<div class="t-price">' + priceHtml + '</div>';
    opt.onclick = function() { selectToken(t); };
    list.appendChild(opt);
  });
}

function formatPrice(p) {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function selectToken(token) {
  if (activeModalSide === "in") {
    selectedTokenIn = { ...token };
  } else {
    selectedTokenOut = { ...token };
  }
  updateTokenDisplay();
  document.getElementById("tokenModal").classList.remove("show");
}

// Debounced search handler
document.addEventListener("DOMContentLoaded", function() {
  var searchInput = document.getElementById("tokenSearch");
  searchInput.addEventListener("input", function() {
    var query = searchInput.value.trim();
    clearTimeout(searchTimeout);

    if (!query) {
      renderTokenList(PRESET_TOKENS);
      return;
    }

    // Filter presets first
    var filtered = PRESET_TOKENS.filter(function(t) {
      return t.symbol.toLowerCase().includes(query.toLowerCase()) ||
             t.name.toLowerCase().includes(query.toLowerCase());
    });

    if (filtered.length > 0 && !isContractAddress(query)) {
      renderTokenList(filtered);
    }

    // If it's a contract address, resolve it
    if (isContractAddress(query)) {
      renderTokenList([], true);
      resolveCA(query);
      return;
    }

    // If no preset match and query is 2+ chars, search DexScreener
    if (filtered.length === 0 && query.length >= 2) {
      searchTimeout = setTimeout(function() {
        renderTokenList([], true);
        searchDexScreener(query);
      }, 400);
    }
  });

  // Close modal on Escape
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") document.getElementById("tokenModal").classList.remove("show");
  });

  // Init display
  updateTokenDisplay();
  document.getElementById("amountIn").addEventListener("input", updateSmartDefault);
  document.getElementById("minAmountOut").addEventListener("input", function() {
    var outAmt = parseFloat(v("minAmountOut")) || 0;
    var usdOut = outAmt * (selectedTokenOut.priceUsd || 0);
    document.getElementById("usdOut").textContent = usdOut > 0 ? "~$" + usdOut.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
  });
});

function isContractAddress(input) {
  return /^0x[a-fA-F0-9]{40}$/.test(input);
}

async function resolveCA(address) {
  try {
    var api = getApi();
    var res = await fetch(api + "/resolve/" + address);
    if (!res.ok) {
      renderTokenList([], false, true);
      return;
    }
    var info = await res.json();
    renderTokenList([info]);
  } catch {
    renderTokenList([], false, true);
  }
}

async function searchDexScreener(query) {
  try {
    var api = getApi();
    var res = await fetch(api + "/search?q=" + encodeURIComponent(query));
    if (!res.ok) {
      renderTokenList([], false, true);
      return;
    }
    var data = await res.json();
    if (data.results && data.results.length > 0) {
      renderTokenList(data.results);
    } else {
      renderTokenList([], false, true);
    }
  } catch {
    renderTokenList([], false, true);
  }
}

// ============================================================================
// WALLET
// ============================================================================

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

// ============================================================================
// COMPETITION
// ============================================================================

async function runCompetition() {
  var apiBase = getApi();
  var btn = document.getElementById("runBtn");
  var statusEl = document.getElementById("competitionStatus");
  btn.disabled = true;

  statusEl.innerHTML = '<span class="status-dot pulse"></span> Fetching solver quotes...';
  statusEl.style.display = "flex";

  var now = Math.floor(Date.now() / 1000);
  // Use symbol for known tokens, CA for custom tokens
  var tokenIn = selectedTokenIn.symbol;
  var tokenOut = selectedTokenOut.symbol;
  // If the token isn't a preset, send the address instead
  var isPresetIn = PRESET_TOKENS.some(function(t) { return t.symbol === selectedTokenIn.symbol; });
  var isPresetOut = PRESET_TOKENS.some(function(t) { return t.symbol === selectedTokenOut.symbol; });
  if (!isPresetIn && selectedTokenIn.address) tokenIn = selectedTokenIn.address;
  if (!isPresetOut && selectedTokenOut.address) tokenOut = selectedTokenOut.address;

  var intent = {
    tokenIn: tokenIn, tokenOut: tokenOut, amountIn: v("amountIn"),
    minAmountOut: v("minAmountOut"), maxSlippageBps: Number(v("maxSlippageBps")),
    maxGasWei: v("maxGasWei"), deadline: now + 3600,
  };

  try {
    statusEl.innerHTML = '<span class="status-dot pulse ai"></span> AI analyzing quotes for MEV risk...';

    var r = await fetch(apiBase + "/compete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: intent, solvers: [{ name: "solver-alpha" }, { name: "solver-beta" }, { name: "solver-gamma" }] }),
    });
    var data = await r.json();
    if (r.ok === false) throw new Error(data.error || "HTTP " + r.status);

    lastBest = data.best;
    statusEl.innerHTML = '<span class="status-dot done"></span> Analysis complete';
    setTimeout(function() { statusEl.style.display = "none"; }, 2000);

    renderResults(data);
    document.getElementById("resultsSection").classList.add("show");
    if (signer) document.getElementById("createBtn").disabled = false;
  } catch (e) {
    statusEl.innerHTML = '<span class="status-dot fail"></span> ' + e.message;
    setTimeout(function() { statusEl.style.display = "none"; }, 5000);
  }
  btn.disabled = false;
}

function scoreColor(s) { return s >= 0.8 ? "var(--green)" : s >= 0.5 ? "var(--yellow)" : "var(--red)"; }
function safeScore(s) { return (typeof s === "number" && isFinite(s)) ? s : 0.5; }

function renderResults(data) {
  var container = document.getElementById("solverCards");
  container.innerHTML = "";
  var bestSolver = data.best ? data.best.solver : null;
  var labels = { "solver-alpha": "Speed-optimized", "solver-beta": "Price-optimized", "solver-gamma": "Balanced" };

  var riskMap = {};
  if (data.riskAnalysis && data.riskAnalysis.quotes) {
    data.riskAnalysis.quotes.forEach(function(rq) { riskMap[rq.solver] = rq.riskRating; });
  }

  (data.quotes || []).forEach(function(q, i) {
    var isWinner = q.solver === bestSolver;
    var risk = riskMap[q.solver] || "unanalyzed";
    var card = document.createElement("div");
    card.className = "solver-card animate" + (isWinner ? " winner" : "") + (risk === "danger" ? " danger-card" : "");
    card.style.animationDelay = i * 0.1 + "s";
    var sc = safeScore(q.score);
    var pct = Math.round(sc * 100);
    var col = scoreColor(sc);
    card.innerHTML =
      '<div class="solver-header">' +
        '<div><div class="solver-name">' + q.solver + '</div><div class="solver-label">' + (labels[q.solver] || "") + '</div></div>' +
        '<div style="display:flex;align-items:center;gap:8px"><span class="risk-badge ' + risk + '">' + risk + '</span><div class="score-badge" style="color:' + col + '">' + pct + '</div></div>' +
      '</div>' +
      '<div class="score-bar-wrap"><div class="score-bar" style="width:' + pct + '%;background:' + col + '"></div></div>' +
      '<div class="stats-row">' +
        '<div class="stat"><div class="stat-val">' + Number(q.expectedOut).toFixed(2) + '</div><div class="stat-label">Expected Out</div></div>' +
        '<div class="stat"><div class="stat-val">' + (Number(q.expectedGasWei)/1e12).toFixed(1) + 'T</div><div class="stat-label">Gas</div></div>' +
        '<div class="stat"><div class="stat-val">' + (q.confidence * 100).toFixed(0) + '%</div><div class="stat-label">Confidence</div></div>' +
        '<div class="stat"><div class="stat-val">' + (q.route ? q.route.join(" > ") : "\u2014") + '</div><div class="stat-label">Route</div></div>' +
      '</div>' +
      '<div class="checks">' +
        '<span class="check ' + (q.checks && q.checks.minOutPass ? "pass" : "fail") + '">' + (q.checks && q.checks.minOutPass ? "\u2713" : "\u2717") + ' Min Output</span>' +
        '<span class="check ' + (q.checks && q.checks.gasPass ? "pass" : "fail") + '">' + (q.checks && q.checks.gasPass ? "\u2713" : "\u2717") + ' Max Gas</span>' +
      '</div>' +
      '<div style="margin-top:6px;font-size:11px;color:var(--text-dim)">' + (q.reason || "") + '</div>';
    container.appendChild(card);
  });

  // Risk analysis
  var riskSection = document.getElementById("riskSection");
  if (data.riskAnalysis && data.riskAnalysis.analyzed) {
    riskSection.style.display = "block";
    document.getElementById("riskRec").textContent = data.riskAnalysis.recommendation || "No recommendation";
    var items = document.getElementById("riskItems");
    items.innerHTML = "";
    (data.riskAnalysis.quotes || []).forEach(function(rq) {
      var el = document.createElement("div");
      el.className = "risk-item";
      el.innerHTML = '<span class="risk-note">' + rq.solver + ": " + (rq.riskNote || "\u2014") + '</span><span class="risk-badge ' + rq.riskRating + '">' + rq.riskRating + '</span>';
      items.appendChild(el);
    });
  } else {
    riskSection.style.display = "none";
  }
}

// ============================================================================
// ONCHAIN
// ============================================================================

async function createIntentOnchain() {
  if (signer === null || lastBest === null) { alert("Connect wallet and run competition first"); return; }
  var btn = document.getElementById("createBtn");
  var txBox = document.getElementById("txBox");
  btn.disabled = true; btn.textContent = "Submitting...";

  try {
    var tIn = selectedTokenIn.address;
    var tOut = selectedTokenOut.address;
    var decimalsIn = selectedTokenIn.decimals || 18;
    var amtIn = ethers.parseUnits(v("amountIn"), decimalsIn);
    var decimalsOut = selectedTokenOut.decimals || 18;
    var minOut = ethers.parseUnits(v("minAmountOut"), decimalsOut);
    var deadline = Math.floor(Date.now() / 1000) + 3600;

    var router = new ethers.Contract(CONTRACT_ADDR, ROUTER_ABI, signer);

    var erc20Abi = ["function approve(address,uint256) returns (bool)"];
    var tokenContract = new ethers.Contract(tIn, erc20Abi, signer);
    txBox.innerHTML = '<span class="status-dot pulse"></span> Approving token...'; txBox.classList.add("show");
    var approveTx = await tokenContract.approve(CONTRACT_ADDR, amtIn);
    await approveTx.wait();

    txBox.innerHTML = '<span class="status-dot pulse"></span> Creating intent onchain...';
    var tx = await router.createIntent(tIn, tOut, amtIn, minOut, Number(v("maxSlippageBps")), BigInt(v("maxGasWei")), deadline);
    txBox.innerHTML = 'Tx sent: <a href="https://base-sepolia.blockscout.com/tx/' + tx.hash + '" target="_blank">' + tx.hash.slice(0,18) + '...</a>';

    var receipt = await tx.wait();
    txBox.innerHTML = '\u2705 Intent created! <a href="https://base-sepolia.blockscout.com/tx/' + tx.hash + '" target="_blank">' + tx.hash.slice(0,18) + '...</a> (block ' + receipt.blockNumber + ')';
  } catch (e) {
    txBox.innerHTML = '\u274C Error: ' + (e.reason || e.message);
    txBox.classList.add("show");
  }
  btn.disabled = false; btn.textContent = "Create Intent Onchain";
}
