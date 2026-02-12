const apiBase = "http://localhost:8787";
function v(id) { return document.getElementById(id).value.trim(); }

document.getElementById("runBtn").addEventListener("click", async () => {
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
    document.getElementById("best").textContent = JSON.stringify(data.best, null, 2);
    document.getElementById("quotes").textContent = JSON.stringify(data.quotes, null, 2);
    document.getElementById("risk").textContent = JSON.stringify(data.riskAnalysis, null, 2);
    const s = data.best;
    document.getElementById("statusLine").textContent = s.valid
      ? `✅ Constraints PASS | Solver: ${s.solver} | Score: ${s.score}`
      : `⚠️ Best fallback: ${s.solver} | ${s.reason}`;
    document.getElementById("statusLine").style.color = s.valid ? "#22c55e" : "#eab308";
  } catch (e) {
    document.getElementById("best").textContent = `Error: ${e.message}`;
  }
  btn.disabled = false; btn.textContent = "Run Solver Competition";
});
