
const API_BASE = "https://cc2gmvn6yn3frmnku7i7276hqu0fcnxq.lambda-url.us-east-1.on.aws/";

const fetchBtn = document.getElementById("fetchBtn");
const latestBtn = document.getElementById("latestBtn");
const byDateBtn = document.getElementById("byDateBtn");
const dateInput = document.getElementById("dateInput");

const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const tableWrap = document.getElementById("tableWrap");

if (
  !fetchBtn ||
  !latestBtn ||
  !byDateBtn ||
  !dateInput ||
  !statusEl ||
  !outputEl ||
  !tableWrap
) {
  throw new Error("Missing required DOM elements. Check index.html IDs.");
}
