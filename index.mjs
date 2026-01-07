// index.mjs

const API_BASE = "https://cc2gmvn6yn3frmnku7i7276hqu0fcnxq.lambda-url.us-east-1.on.aws/"; // lambda functgion url

const fetchBtn = document.getElementById("fetchBtn");
const latestBtn = document.getElementById("latestBtn");
const byDateBtn = document.getElementById("byDateBtn");
const dateInput = document.getElementById("dateInput");

const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const tableWrap = document.getElementById("tableWrap");

function setStatus(msg) {
  statusEl.textContent = msg;
}

function showJson(obj) {
  outputEl.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

function renderTable(item) {
  const rows = item.rows || [];
  if (!rows.length) {
    tableWrap.innerHTML = "<p>No rows to display.</p>";
    return;
  }

  const html = `
    <div>
      <div><strong>As of:</strong> ${item.asOf || item.sk || ""}</div>
      <div><strong>Universe:</strong> ${item.universe || ""}</div>
      <div><strong>Model:</strong> ${item.modelVersionId || ""}</div>
      <table>
        <thead>
          <tr><th>Rank</th><th>Ticker</th><th>Score</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr><td>${r.rank}</td><td>${r.ticker}</td><td>${r.score}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
  tableWrap.innerHTML = html;
}

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

fetchBtn.addEventListener("click", async () => {
  try {
    setStatus("Fetching EOD from Yahoo and publishing...");
    showJson("");
    tableWrap.innerHTML = "";

    const data = await api("/admin/fetch-eod", {
      method: "POST",
      body: JSON.stringify({ tickers: ["AAPL", "GOOG"] }),
    });

    setStatus("Published. Now loading latest watchlist...");
    const latest = await api("/watchlists/latest");
    setStatus("Loaded latest watchlist.");
    renderTable(latest);
    showJson(latest);
  } catch (e) {
    setStatus("Error.");
    showJson(String(e));
  }
});

latestBtn.addEventListener("click", async () => {
  try {
    setStatus("Loading latest watchlist...");
    const latest = await api("/watchlists/latest");
    setStatus("Loaded latest watchlist.");
    renderTable(latest);
    showJson(latest);
  } catch (e) {
    setStatus("Error.");
    showJson(String(e));
  }
});

byDateBtn.addEventListener("click", async () => {
  try {
    const d = dateInput.value;
    if (!d) {
      setStatus("Pick a date first.");
      return;
    }
    setStatus(`Loading watchlist for ${d}...`);
    const item = await api(`/watchlists/${encodeURIComponent(d)}`);
    setStatus(`Loaded watchlist for ${d}.`);
    renderTable(item);
    showJson(item);
  } catch (e) {
    setStatus("Error.");
    showJson(String(e));
  }
});
