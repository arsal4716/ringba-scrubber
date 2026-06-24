"use strict";

const axios = require("axios");
const logger = require("../utils/logger");

/**
 * QC tools client — callcheckai.com
 *
 * Flow:
 *   1) POST /api/auth/login { email, password } -> data.token (JWT, ~7d)
 *   2) GET  /api/calls/export?... (Bearer token) -> CSV
 *
 * The export CSV looks like:
 *   Caller ID,Campaign Name
 *   "13469339782","ACA-Xfers-CPL-RTB"
 *
 * We only keep the Caller ID column.
 */

const BASE_URL = (process.env.QC_API_BASE || "https://callcheckai.com/api").replace(/\/+$/, "");
const EMAIL = process.env.QC_API_EMAIL || "";
const PASSWORD = process.env.QC_API_PASSWORD || "";
const TIMEOUT_MS = Number(process.env.QC_API_TIMEOUT_MS || 60000);

const http = axios.create({
  timeout: TIMEOUT_MS,
  validateStatus: (s) => s >= 200 && s < 300,
});

class QcToolsService {
  constructor() {
    this._token = null;
    this._tokenExpiresAt = 0; // epoch ms
  }

  _assertCreds() {
    if (!EMAIL || !PASSWORD) {
      throw new Error(
        "QC tools credentials missing — set QC_API_EMAIL and QC_API_PASSWORD"
      );
    }
  }

  /**
   * Login and cache the JWT. Re-uses a cached token until it is
   * within 1h of expiry (token TTL is ~7d).
   */
  async getToken(force = false) {
    if (!force && this._token && Date.now() < this._tokenExpiresAt - 60 * 60 * 1000) {
      return this._token;
    }

    this._assertCreds();

    const url = `${BASE_URL}/auth/login`;
    const res = await http.post(
      url,
      { email: EMAIL, password: PASSWORD },
      { headers: { "Content-Type": "application/json", Accept: "application/json" } }
    );

    const token = res?.data?.data?.token || res?.data?.token;
    if (!token) {
      throw new Error("QC login succeeded but no token was returned");
    }

    // expiresIn is like "7d"; default cache window 6 days.
    this._token = token;
    this._tokenExpiresAt = Date.now() + 6 * 24 * 60 * 60 * 1000;

    logger.info("[qcTools] Logged in, token cached");
    return token;
  }

  /**
   * Fetch caller IDs from the export endpoint.
   *
   * @param {{ datePreset?:string, disposition?:string, search?:string }} params
   * @returns {Promise<{ numbers:string[], rawRows:number }>}
   */
  async fetchCallerIds(params = {}) {
    const datePreset = params.datePreset || "last_6_months";
    const disposition = params.disposition || "Sales";
    const search = params.search || "";

    const query = {
      datePreset,
      disposition,
      columns: "callerId,campaignName",
      fmt: "csv",
    };
    if (search) query.search = search;

    let token = await this.getToken();

    const doRequest = async (bearer) =>
      http.get(`${BASE_URL}/calls/export`, {
        params: query,
        headers: { Authorization: `Bearer ${bearer}`, Accept: "text/csv" },
        responseType: "text",
      });

    let res;
    try {
      res = await doRequest(token);
    } catch (err) {
      // Token may have expired early — retry once with a fresh login.
      if (err?.response?.status === 401) {
        logger.warn("[qcTools] 401 on export, refreshing token and retrying");
        token = await this.getToken(true);
        res = await doRequest(token);
      } else {
        throw err;
      }
    }

    const numbers = parseCallerIdsFromCsv(res.data);

    logger.info(
      `[qcTools] export datePreset=${datePreset} disposition=${disposition} search=${search || "-"} callerIds=${numbers.length}`
    );

    return { numbers, rawRows: numbers.length };
  }
}

/**
 * Parse the "Caller ID" column out of the export CSV.
 * Handles optional quotes and a header row.
 */
function parseCallerIdsFromCsv(csvText) {
  if (!csvText || typeof csvText !== "string") return [];

  const lines = csvText.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    const firstCell = splitCsvLine(line)[0] || "";
    const value = firstCell.replace(/^"|"$/g, "").trim();

    // Skip header row(s).
    if (i === 0 && /caller/i.test(value)) continue;
    if (!/\d/.test(value)) continue;

    out.push(value);
  }

  return out;
}

/**
 * Minimal CSV line splitter that respects double-quoted fields.
 */
function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

module.exports = new QcToolsService();
module.exports.parseCallerIdsFromCsv = parseCallerIdsFromCsv;
