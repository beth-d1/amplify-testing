const AWS = require("aws-sdk");

const s3 = new AWS.S3();
const ddb = new AWS.DynamoDB.DocumentClient();

const BUCKET = process.env.WATCHLIST_BUCKET;
const TABLE = process.env.WATCHLIST_TABLE;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  };
}

function resp(statusCode, bodyObj) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(bodyObj),
  };
}

function todayIsoDateUTC() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function fetchYahooLatestClose(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?range=1mo&interval=1d&includePrePost=false&events=div%7Csplit`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Yahoo fetch failed for ${ticker}: ${r.status}`);
  const json = await r.json();

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo response missing result for ${ticker}`);

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (c != null && Number.isFinite(c)) {
      const ts = timestamps[i] ? new Date(timestamps[i] * 1000).toISOString() : null;
      return { close: c, sourceTimestamp: ts, raw: json };
    }
  }
  throw new Error(`No valid close found for ${ticker}`);
}

async function putJsonToS3(key, obj) {
  await s3
    .putObject({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(obj),
      ContentType: "application/json",
    })
    .promise();
}

async function putWatchlistToDdb(asOf, watchlist, s3Key) {
  await ddb
    .put({
      TableName: TABLE,
      Item: {
        pk: "WATCHLIST",
        sk: asOf,
        asOf,
        universe: watchlist.universe,
        modelVersionId: watchlist.modelVersionId,
        topN: watchlist.topN,
        rows: watchlist.rows,
        s3Key,
        createdAt: new Date().toISOString(),
      },
    })
    .promise();
}

async function getWatchlistByDate(date) {
  const out = await ddb
    .get({
      TableName: TABLE,
      Key: { pk: "WATCHLIST", sk: date },
    })
    .promise();
  return out.Item || null;
}

async function getLatestWatchlist() {
  const out = await ddb
    .query({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "WATCHLIST" },
      ScanIndexForward: false,
      Limit: 1,
    })
    .promise();
  return out.Items?.[0] || null;
}

async function getRecentDates(limit = 60) {
  const out = await ddb
    .query({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "WATCHLIST" },
      ScanIndexForward: false,
      Limit: Math.min(Math.max(limit, 1), 365),
      ProjectionExpression: "sk",
    })
    .promise();
  return (out.Items || []).map((x) => x.sk);
}

function buildWatchlist(asOf, rows) {
  return {
    asOf,
    universe: "S&P 1500 (TEST: AAPL+GOOG)",
    modelVersionId: "demo-yahoo-v0",
    topN: rows.length,
    rows,
  };
}

exports.handler = async (event) => {
  try {
    if (!BUCKET || !TABLE) {
      return resp(500, { message: "Missing WATCHLIST_BUCKET or WATCHLIST_TABLE env vars" });
    }

    const method = event.requestContext?.http?.method || event.httpMethod || "GET";
    const path = event.rawPath || event.path || "/";
    const qs = event.queryStringParameters || {};

    // CORS preflight
    if (method === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    // POST /admin/fetch-eod  (seed + publish)
    if (method === "POST" && path === "/admin/fetch-eod") {
      const body = event.body ? JSON.parse(event.body) : {};
      const tickers =
        Array.isArray(body.tickers) && body.tickers.length > 0 ? body.tickers : ["AAPL", "GOOG"];
      const asOf = body.asOf || todayIsoDateUTC();

      const results = [];
      for (const t of tickers) {
        const data = await fetchYahooLatestClose(t);
        results.push({ ticker: t, ...data });
      }

      // Write raw to S3
      for (const r of results) {
        await putJsonToS3(`raw/yahoo/eod/date=${asOf}/ticker=${r.ticker}.json`, r.raw);
      }

      // Demo score: close price (placeholder for model)
      const rows = results
        .map((r) => ({ ticker: r.ticker, close: r.close }))
        .sort((a, b) => b.close - a.close)
        .map((r, i) => ({ rank: i + 1, ticker: r.ticker, score: Number(r.close.toFixed(6)) }));

      const watchlist = buildWatchlist(asOf, rows);

      // Write watchlist to S3
      const watchlistKey = `watchlists/date=${asOf}/watchlist.json`;
      await putJsonToS3(watchlistKey, watchlist);

      // Write serving record to DynamoDB
      await putWatchlistToDdb(asOf, watchlist, watchlistKey);

      return resp(200, { ok: true, asOf, tickers, watchlistS3Key: watchlistKey });
    }

    // GET /watchlists/latest
    if (method === "GET" && path === "/watchlists/latest") {
      const item = await getLatestWatchlist();
      if (!item) return resp(404, { message: "No watchlists found yet. Run POST /admin/fetch-eod." });
      return resp(200, item);
    }

    // GET /watchlists/recent?days=60
    if (method === "GET" && path === "/watchlists/recent") {
      const days = Number(qs.days || "60");
      const dates = await getRecentDates(Number.isFinite(days) ? days : 60);
      return resp(200, { dates });
    }

    // GET /watchlists/YYYY-MM-DD
    const m = path.match(/^\/watchlists\/(\d{4}-\d{2}-\d{2})$/);
    if (method === "GET" && m) {
      const date = m[1];
      if (!isIsoDate(date)) return resp(400, { message: "Invalid date format" });
      const item = await getWatchlistByDate(date);
      if (!item) return resp(404, { message: `No watchlist for ${date}` });
      return resp(200, item);
    }
    if (!fetchBtn || !latestBtn || !byDateBtn || !dateInput || !statusEl || !outputEl || !tableWrap) {
}


    return resp(404, { message: "Not Found", method, path });
  } catch (e) {
    return resp(500, { message: "Server error", error: String(e) });
  }
};
