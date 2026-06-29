"use strict";

/**
 * Direct Kaliper MCP client — no LLM in the loop.
 *
 * Talks to the Kaliper MCP server over JSON-RPC (streamable HTTP), pages
 * through kaliper_search_pings, filters suppressed caller IDs, and builds
 * the multi-sheet workbook. Ported from the reference Python client.
 *
 * Env:
 *   KALIPER_TOKEN        – bearer token (required to run)
 *   KALIPER_URL          – MCP endpoint (default app-0.thekaliper.com/mcp)
 *   KALIPER_TIMEZONE     – default "America/New_York"
 *   KALIPER_PAGE_SIZE    – default 100
 *   KALIPER_DELAY_MS     – politeness pause between pages (default 250)
 *   KALIPER_LM_TARGETS   – comma-separated LeadMarket target ids
 *   KALIPER_HC_TARGETS   – comma-separated HealthConnect target ids
 */

const axios = require("axios");
const XLSX = require("xlsx");
const logger = require("../utils/logger");

const KALIPER_URL = process.env.KALIPER_URL || "https://app-0.thekaliper.com/mcp";
const TIMEZONE = process.env.KALIPER_TIMEZONE || "America/New_York";
const PAGE_SIZE = Number(process.env.KALIPER_PAGE_SIZE || 100);
const DELAY_MS = Number(process.env.KALIPER_DELAY_MS || 250);

function parseIds(value, fallback) {
  const raw = (value || fallback || "")
    .split(",")
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return raw;
}

const LM_TARGETS = parseIds(process.env.KALIPER_LM_TARGETS, "44629,44628,43527");
const HC_TARGETS = parseIds(process.env.KALIPER_HC_TARGETS, "43523,43664,44626");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ──────────────────────────────────────────────────────────────
// Minimal MCP-over-HTTP client
// ──────────────────────────────────────────────────────────────
class KaliperMCP {
  constructor(url, token) {
    this.url = url;
    this._id = 0;
    this.sessionId = null;
    this.http = axios.create({
      timeout: 60000,
      transformResponse: (r) => r, // keep the raw body; we parse it ourselves
      validateStatus: () => true,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
    });
  }

  _nextId() {
    return ++this._id;
  }

  // Handle both a single JSON body and an SSE stream.
  _parse(resp) {
    const ctype = resp.headers["content-type"] || "";
    const text = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);

    if (ctype.includes("text/event-stream")) {
      let last = null;
      for (const lineRaw of text.split(/\r?\n/)) {
        const line = lineRaw.trim();
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          try {
            last = JSON.parse(payload);
          } catch {
            /* ignore non-JSON keepalive lines */
          }
        }
      }
      if (last === null) {
        throw new Error(`No parseable SSE data. Raw: ${text.slice(0, 500)}`);
      }
      return last;
    }

    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  async _rpc(method, params, wantId = true) {
    const body = { jsonrpc: "2.0", method };
    if (wantId) body.id = this._nextId();
    if (params !== undefined && params !== null) body.params = params;

    const headers = {};
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const resp = await this.http.post(this.url, JSON.stringify(body), { headers });

    const sid = resp.headers["mcp-session-id"];
    if (sid) this.sessionId = sid;

    if (resp.status === 202) return {}; // notification accepted, no body
    if (resp.status >= 400) {
      throw new Error(`Kaliper HTTP ${resp.status}: ${String(resp.data).slice(0, 300)}`);
    }
    if (!String(resp.data || "").trim()) return {};
    return this._parse(resp);
  }

  async initialize() {
    const result = await this._rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "kaliper-direct", version: "1.0" },
    });
    if (result.error) throw new Error(`initialize failed: ${JSON.stringify(result.error)}`);
    // Notify ready (no id, no response expected).
    await this._rpc("notifications/initialized", {}, false);
  }

  async callTool(name, args) {
    const result = await this._rpc("tools/call", { name, arguments: args });
    if (result.error) throw new Error(`tools/call error: ${JSON.stringify(result.error)}`);

    const inner = result.result || {};
    if (inner.isError) throw new Error(`Kaliper tool error: ${JSON.stringify(inner)}`);

    for (const block of inner.content || []) {
      if (block.type === "text") {
        try {
          return JSON.parse(block.text || "");
        } catch {
          /* try next block */
        }
      }
    }
    if (inner.structuredContent) return inner.structuredContent;
    throw new Error("Could not parse Kaliper tool result");
  }
}

// ──────────────────────────────────────────────────────────────
// Pagination
// ──────────────────────────────────────────────────────────────
async function fetchAllPages(mcp, targetIds, label, dateFrom, dateTo, onPage) {
  const all = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages) {
    const data = await mcp.callTool("kaliper_search_pings", {
      datePreset: "CUSTOM_RANGE",
      dateFrom,
      dateTo,
      timezone: TIMEZONE,
      targetIds,
      page,
      size: PAGE_SIZE,
    });

    const pings = data?.data?.list || [];
    all.push(...pings);
    totalPages = data?.data?.totalPages || 1;
    logger.info(`[kaliper] ${label}: page ${page + 1}/${totalPages} got ${pings.length} (${all.length} total)`);

    if (typeof onPage === "function") {
      onPage(page + 1, totalPages, all.length);
    }

    page += 1;
    if (page < totalPages) await sleep(DELAY_MS);
  }

  return all;
}

// ──────────────────────────────────────────────────────────────
// Filtering / formatting
// ──────────────────────────────────────────────────────────────
function isLmBlocked(ping) {
  const msg = (ping.buyerResponseBody || {}).message || "";
  return String(msg).toLowerCase().includes("callerid blocked");
}

function isHcSuppressed(ping) {
  return JSON.stringify(ping.buyerResponseBody || "").toLowerCase().includes("phs_suppressed");
}

function fmtPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw || "";
}

function pingToRow(ping, buyerLabel, responseLabel) {
  return {
    phone_fmt: fmtPhone(ping.phone || ""),
    phone_raw: ping.phone || "",
    buyer: buyerLabel,
    response: responseLabel,
    zip: ping.zip || "",
    timestamp: ping.createdAt || "",
    target_id: ping.targetId,
    buyer_id: ping.buyerId,
  };
}

// ──────────────────────────────────────────────────────────────
// Workbook builder (SheetJS — multi-sheet .xlsx)
// ──────────────────────────────────────────────────────────────
const HDR_COLS = [
  "Phone Number", "Raw Phone", "Buyer", "Response", "ZIP",
  "Timestamp (UTC)", "Target ID", "Buyer ID",
];
const DATA_WIDTHS = [22, 16, 18, 20, 8, 26, 12, 10];

function rowToArray(r) {
  return [r.phone_fmt, r.phone_raw, r.buyer, r.response, r.zip, r.timestamp, r.target_id, r.buyer_id];
}

function buildWorkbook(lmRows, hcRows, label) {
  const wb = XLSX.utils.book_new();

  const lmPhones = new Set(lmRows.map((r) => r.phone_raw));
  const hcPhones = new Set(hcRows.map((r) => r.phone_raw));
  const overlap = [...lmPhones].filter((p) => hcPhones.has(p)).sort();

  const byPhone = (a, b) => String(a.phone_raw).localeCompare(String(b.phone_raw));

  // Sheet 1 — all
  const combined = [...lmRows, ...hcRows].sort(byPhone);
  const allAoa = [HDR_COLS, ...combined.map(rowToArray)];
  const wsAll = XLSX.utils.aoa_to_sheet(allAoa);
  wsAll["!cols"] = DATA_WIDTHS.map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsAll, "All Suppressed Numbers");

  // Sheet 2 — LeadMarket
  const wsLm = XLSX.utils.aoa_to_sheet([HDR_COLS, ...lmRows.slice().sort(byPhone).map(rowToArray)]);
  wsLm["!cols"] = DATA_WIDTHS.map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsLm, "LeadMarket - CallerId Blocked");

  // Sheet 3 — HealthConnect
  const wsHc = XLSX.utils.aoa_to_sheet([HDR_COLS, ...hcRows.slice().sort(byPhone).map(rowToArray)]);
  wsHc["!cols"] = DATA_WIDTHS.map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsHc, "HealthConnect - phs_suppressed");

  // Sheet 4 — summary
  const summaryAoa = [
    ["Metric", "Value"],
    ["Date / Window", label],
    ["LeadMarket total ping rows (CallerId Blocked)", lmRows.length],
    ["LeadMarket unique phone numbers", lmPhones.size],
    ["HealthConnect total ping rows (phs_suppressed)", hcRows.length],
    ["HealthConnect unique phone numbers", hcPhones.size],
    ["Numbers on BOTH lists (overlap)", overlap.length],
    ["Overlap phone numbers", overlap.map(fmtPhone).join(", ") || "None"],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSum["!cols"] = [{ wch: 50 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  // Sheet 5 — overlap
  const overlapAoa = [
    ["Phone Number", "Raw Phone", "On LeadMarket List", "On HealthConnect List"],
    ...overlap.map((p) => [fmtPhone(p), p, "Yes", "Yes"]),
  ];
  const wsOv = XLSX.utils.aoa_to_sheet(overlapAoa);
  wsOv["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 24 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsOv, "Both Lists (Overlap)");

  return { wb, overlap, lmPhones, hcPhones };
}

// ──────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────
async function runKaliperReport({ dateFrom, dateTo, label, onProgress } = {}) {
  const token = (process.env.KALIPER_TOKEN || "").trim();
  if (!token) {
    throw new Error("KALIPER_TOKEN is not set on the server");
  }
  if (!dateFrom || !dateTo) {
    throw new Error("dateFrom and dateTo are required");
  }

  const report = (percent, message, fetched) => {
    if (typeof onProgress === "function") onProgress(percent, message, fetched);
  };

  logger.info(`[kaliper] Run started window=${dateFrom}..${dateTo}`);
  report(2, "Connecting to Kaliper…", 0);
  const mcp = new KaliperMCP(KALIPER_URL, token);
  await mcp.initialize();

  // LeadMarket = first ~45%, HealthConnect = next ~45%, build = final.
  const lmPings = await fetchAllPages(mcp, LM_TARGETS, "LeadMarket", dateFrom, dateTo, (page, totalPages, fetched) =>
    report(Math.round((page / totalPages) * 45), `Fetching LeadMarket ${page}/${totalPages}`, fetched)
  );
  const lmRows = lmPings.filter(isLmBlocked).map((p) => pingToRow(p, "LeadMarket 360", "CallerId Blocked"));

  const hcPings = await fetchAllPages(mcp, HC_TARGETS, "HealthConnect", dateFrom, dateTo, (page, totalPages, fetched) =>
    report(45 + Math.round((page / totalPages) * 45), `Fetching HealthConnect ${page}/${totalPages}`, lmPings.length + fetched)
  );
  const hcRows = hcPings.filter(isHcSuppressed).map((p) => pingToRow(p, "HealthConnect", "phs_suppressed"));

  report(95, "Building workbook…", lmPings.length + hcPings.length);

  const { wb, overlap, lmPhones, hcPhones } = buildWorkbook(lmRows, hcRows, label || `${dateFrom} .. ${dateTo}`);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const summary = {
    lmRows: lmRows.length,
    lmUnique: lmPhones.size,
    hcRows: hcRows.length,
    hcUnique: hcPhones.size,
    overlap: overlap.length,
    lmPingsScanned: lmPings.length,
    hcPingsScanned: hcPings.length,
    recordCount: lmRows.length + hcRows.length,
  };
  logger.info(`[kaliper] Run done: ${JSON.stringify(summary)}`);

  return { buffer, summary };
}

module.exports = { runKaliperReport, fmtPhone };
