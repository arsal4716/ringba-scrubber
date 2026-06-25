"use strict";

const axios = require("axios");
const logger = require("../utils/logger");

/**
 * CallGrid client.
 *
 * Calls the CallGrid call-report API:
 *   POST {BASE}/call?organizationId={ORG_ID}
 *   Authorization: Bearer {CALLGRID_API_TOKEN}
 *
 * The body carries a date range + tag filters (CampaignName, CallPaid)
 * and zero-based pagination. See fetchNumbers() for the exact shape.
 *
 * Required env:
 *   CALLGRID_API_BASE   – e.g. https://api.callgrid.com/api
 *   CALLGRID_API_TOKEN  – bearer token
 *   CALLGRID_ORG_ID     – organizationId query value
 * Optional:
 *   CALLGRID_REPORT_TZ  – report timezone (default "US/Eastern")
 *   CALLGRID_PAGE_SIZE  – maxItems per page (default 500)
 *   CALLGRID_MAX_PAGES  – safety cap on pages (default 400)
 *
 * Parsing stays defensive: rows are pulled from several common envelope
 * keys and phone numbers from several common field names, so an
 * unexpected response shape degrades to empty/skipped instead of
 * crashing the daily run. When rows are returned but no number field is
 * recognised, the first row's keys are logged to make mapping trivial.
 */

const BASE_URL = (process.env.CALLGRID_API_BASE || "https://api.callgrid.com/api").replace(/\/+$/, "");
const TOKEN = process.env.CALLGRID_API_TOKEN || "";
const ORG_ID = process.env.CALLGRID_ORG_ID || "";
const REPORT_TZ = process.env.CALLGRID_REPORT_TZ || "US/Eastern";
const TIMEOUT_MS = Number(process.env.CALLGRID_API_TIMEOUT_MS || 30000);
const PAGE_SIZE = Number(process.env.CALLGRID_PAGE_SIZE || 500);
const MAX_PAGES = Number(process.env.CALLGRID_MAX_PAGES || 400);

const http = axios.create({
  timeout: TIMEOUT_MS,
  validateStatus: (s) => s >= 200 && s < 300,
});

// Pull an array of call rows out of whatever envelope the API returns.
function extractRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.items)) return data.data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.calls)) return data.calls;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

// Pull a phone number out of a single call row. CallGrid returns the
// caller number under several (capitalized) keys; prefer the plain
// digits form, then fall back to common alternatives.
function extractNumber(row) {
  if (!row || typeof row !== "object") return "";
  return (
    row.InboundNumberNoPlus || // "14802442991"
    row.InboundNumber ||       // "+14802442991"
    row.CallerId ||            // "+14802442991"
    row.callerId ||
    row.callerNumber ||
    row.from ||
    row.fromNumber ||
    row.ani ||
    row.phoneNumber ||
    row.phone ||
    row.number ||
    ""
  );
}

// YYYY-MM-DD for a Date.
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

class CallGridService {
  isConfigured() {
    return Boolean(BASE_URL && TOKEN && ORG_ID);
  }

  /**
   * @param {{ days?:number, paid?:boolean, campaignIds?:string[] }} opts
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
    const startDate = ymd(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const endDate = ymd(new Date());

    // Build the tag-filter rules: campaign ids + (optionally) paid only.
    const rules = [];
    if (Array.isArray(opts.campaignIds) && opts.campaignIds.length) {
      rules.push({
        tagName: "CampaignName",
        values: opts.campaignIds,
        condition: "equals",
        customOptions: [],
        labelMap: {},
      });
    }
    if (opts.paid === true) {
      rules.push({
        tagName: "CallPaid",
        values: ["true"],
        condition: "equals",
        customOptions: [],
        labelMap: { true: "true" },
      });
    }

    const filters = rules.length
      ? { items: [{ operator: "AND", rules }] }
      : { items: [] };

    let loggedKeys = false;
    const numbers = [];
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = {
          startDate,
          endDate,
          filters,
          permission: "",
          page, // zero-based
          maxItems: PAGE_SIZE,
          sortColumn: "createdAt",
          sortDirection: "desc",
          reportTimeZone: REPORT_TZ,
          outcomes: [],
          isSortFieldTag: false,
          useCursor: false,
        };

        const res = await http.post(`${BASE_URL}/call`, body, {
          params: { organizationId: ORG_ID },
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });

        const rows = extractRows(res?.data);

        // Help future debugging: if rows came back but none yielded a
        // number, surface the available field names once.
        if (rows.length && !loggedKeys) {
          const first = rows.find((r) => r && typeof r === "object");
          if (first && !extractNumber(first)) {
            logger.warn(
              `[callGrid] No known phone field on call rows. Available keys: ${Object.keys(first).join(", ")}`
            );
          }
          loggedKeys = true;
        }

        for (const row of rows) {
          const num = extractNumber(row);
          if (num) numbers.push(String(num));
        }

        // Stop on a short/empty page — end of the result set.
        if (rows.length < PAGE_SIZE) break;
      }

      logger.info(
        `[callGrid] fetched=${numbers.length} (${startDate}..${endDate}, campaigns=${(opts.campaignIds || []).length}, paid=${opts.paid === true})`
      );
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
