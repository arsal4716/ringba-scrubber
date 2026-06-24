"use strict";

const axios = require("axios");
const logger = require("../utils/logger");

/**
 * CallGrid client — NOT wired up yet.
 *
 * The data shape / auth for CallGrid's reporting API is still TBD,
 * so this is a safe stub: it logs and returns an empty list unless
 * both CALLGRID_API_BASE and CALLGRID_API_TOKEN are configured AND
 * the source is explicitly enabled in config/constants.js.
 *
 * When CallGrid access is confirmed, implement fetchNumbers() to
 * call the real endpoint and parse the phone numbers — the rest of
 * the pipeline already merges whatever this returns.
 */

const BASE_URL = (process.env.CALLGRID_API_BASE || "").replace(/\/+$/, "");
const TOKEN = process.env.CALLGRID_API_TOKEN || "";
const TIMEOUT_MS = Number(process.env.CALLGRID_API_TIMEOUT_MS || 30000);

const http = axios.create({
  timeout: TIMEOUT_MS,
  validateStatus: (s) => s >= 200 && s < 300,
});

class CallGridService {
  isConfigured() {
    return Boolean(BASE_URL && TOKEN);
  }

  /**
   * @param {{ search?:string, days?:number, paid?:boolean }} opts
   * @returns {Promise<{ numbers:string[], skipped:boolean, reason?:string }>}
   */
  async fetchNumbers(opts = {}) {
    if (!this.isConfigured()) {
      logger.warn(
        "[callGrid] Not configured (CALLGRID_API_BASE / CALLGRID_API_TOKEN) — skipping"
      );
      return { numbers: [], skipped: true, reason: "not_configured" };
    }

    // ── Placeholder request — adjust path/params once CallGrid's
    //    reporting API is documented. Kept defensive so an
    //    unexpected response shape never crashes the daily run.
    try {
      const res = await http.get(`${BASE_URL}/calls/export`, {
        params: {
          search: opts.search || "",
          days: opts.days || 30,
          paid: opts.paid ? "true" : "false",
        },
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
      });

      const rows = Array.isArray(res?.data?.data)
        ? res.data.data
        : Array.isArray(res?.data)
        ? res.data
        : [];

      const numbers = rows
        .map((r) => r?.callerId || r?.phoneNumber || r?.number || "")
        .filter(Boolean);

      logger.info(`[callGrid] fetched=${numbers.length}`);
      return { numbers, skipped: false };
    } catch (err) {
      logger.error(`[callGrid] fetch failed: ${err?.message || err}`);
      return { numbers: [], skipped: true, reason: err?.message || "error" };
    }
  }
}

module.exports = new CallGridService();
