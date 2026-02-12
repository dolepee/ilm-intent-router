function v(id) {
  return document.getElementById(id).value;
}

function getApiFromQuery() {
  const u = new URL(window.location.href);
  return u.searchParams.get('api') || '';
}

function normalizeApi(s) {
  return (s || '').trim().replace(/\/$/, '');
}

const qApi = getApiFromQuery();
const savedApi = localStorage.getItem('ilm_api_base') || '';
const apiInput = document.getElementById('apiBase');
apiInput.value = qApi || savedApi;

apiInput.addEventListener('change', () => {
  localStorage.setItem('ilm_api_base', normalizeApi(apiInput.value));
});

document.getElementById('runBtn').addEventListener('click', async () => {
  const apiBase = normalizeApi(v('apiBase'));
  if (!apiBase) {
    document.getElementById('best').textContent = 'Error: API Base URL is required';
    return;
  }

  localStorage.setItem('ilm_api_base', apiBase);

  const now = Math.floor(Date.now() / 1000);
  const intent = {
    tokenIn: v('tokenIn'),
    tokenOut: v('tokenOut'),
    amountIn: v('amountIn'),
    minAmountOut: v('minAmountOut'),
    maxSlippageBps: Number(v('maxSlippageBps')),
    maxGasWei: v('maxGasWei'),
    deadline: now + 3600,
  };

  const body = {
    intent,
    solvers: [{ name: 'solver-alpha' }, { name: 'solver-beta' }, { name: 'solver-gamma' }],
  };

  try {
    const r = await fetch(`${apiBase}/compete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);

    document.getElementById('best').textContent = JSON.stringify(data.best, null, 2);
    document.getElementById('quotes').textContent = JSON.stringify(data.quotes, null, 2);

    const s = data.best;
    const status = s.valid
      ? `✅ Constraints PASS | Solver: ${s.solver} | Score: ${s.score}`
      : `⚠️ No fully valid quote. Best fallback: ${s.solver} | Reason: ${s.reason}`;
    document.getElementById('statusLine').textContent = status;
  } catch (e) {
    document.getElementById('best').textContent = `Error: ${e.message}`;
  }
});
