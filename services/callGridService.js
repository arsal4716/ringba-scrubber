"use strict";

const axios = require("axios");
const logger = require("../utils/logger");

/**
 * CallGrid client.
 *
 * Calls the CallGrid reporting API:
 *   GET {BASE}/call?organizationId={ORG_ID}
 * with `Authorization: Bearer {CALLGRID_API_TOKEN}`.
 *
 * Required env:
 *   CALLGRID_API_BASE   – e.g. https://api.callgrid.com/api
 *   CALLGRID_API_TOKEN  – bearer token
 *   CALLGRID_ORG_ID     – organizationId query value
 *
 * The response shape isn't strictly documented, so parsing is kept
 * defensive: rows are pulled from several common envelope keys, phone
 * numbers from several common field names, and any failure degrades to
 * an empty/skipped result instead of crashing the daily run.
 */

const BASE_URL = (process.env.CALLGRID_API_BASE || "https://api.callgrid.com/api").replace(/\/+$/, "");
const TOKEN = process.env.CALLGRID_API_TOKEN || "";
const ORG_ID = process.env.CALLGRID_ORG_ID || "";
const TIMEOUT_MS = Number(process.env.CALLGRID_API_TIMEOUT_MS || 30000);
const PAGE_SIZE = Number(process.env.CALLGRID_PAGE_SIZE || 1000);
const MAX_PAGES = Number(process.env.CALLGRID_MAX_PAGES || 200); // hard stop, ~200k rows

const http = axios.create({
  timeout: TIMEOUT_MS,
  validateStatus: (s) => s >= 200 && s < 300,
});

// Pull an array of rows out of whatever envelope the API returns.
function extractRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.calls)) return data.calls;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

// Pull a phone number out of a single row, trying common field names.
function extractNumber(row) {
  if (!row || typeof row !== "object") return "";
  return (
    row.callerId ||
    row.callerNumber ||
    row.from ||
    row.fromNumber ||
    row.phoneNumber ||
    row.phone ||
    row.number ||
    row.ani ||
    ""
  );
}

class CallGridService {
  isConfigured() {
    return Boolean(BASE_URL && TOKEN && ORG_ID);
  }

  /**
   * @param {{ search?:string, days?:number, paid?:boolean }} opts
   * @returns {Promise<{ numbers:string[], skipped:boolean, reason?:string }>}
   */
  async fetchNumbers(opts = {}) {
    if (!this.isConfigured()) {
      logger.warn(
        "[callGrid] Not configured (CALLGRID_API_BASE / CALLGRID_API_TOKEN / CALLGRID_ORG_ID) — skipping"
      );
      return { numbers: [], skipped: true, reason: "not_configured" };
    }

    const days = Number(opts.days) || 30;
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const numbers = [];
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await http.get(`${BASE_URL}/call`, {
          params: {
            organizationId: ORG_ID,
            search: opts.search || undefined,
            paid: opts.paid ? "true" : undefined,
            from: fromDate,
            page,
            limit: PAGE_SIZE,
          },
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: "application/json",
          },
        });

        const rows = extractRows(res?.data);
        for (const row of rows) {
          const num = extractNumber(row);
          if (num) numbers.push(String(num));
        }

        // Stop when the API returns a short/empty page — the usual
        // signal that we've reached the end of the result set.
        if (rows.length < PAGE_SIZE) break;
      }

      logger.info(`[callGrid] fetched=${numbers.length} (search="${opts.search || ""}")`);
      return { numbers, skipped: false };
    } catch (err) {
      const status = err?.response?.status;
      logger.error(
        `[callGrid] fetch failed${status ? ` (status ${status})` : ""}: ${err?.message || err}`
      );
      return { numbers, skipped: true, reason: err?.message || "error" };
    }
  }
}

module.exports = new CallGridService();
