"use strict";

const axios = require("axios");
const logger = require("../utils/logger");

/**
 * Ringba Bulk Tag automation.
 *
 * Uses the account-scoped v2 API (same Token auth as the report API
 * in ringbaService.js):
 *
 *   Base: https://api.ringba.com/v2/{accountId}
 *   Auth: Authorization: Token <token>
 *
 * Flow (per target):
 *   1) POST /bulkTags { name, csv_list } -> bulkTagUpload.id
 *   2) GET  /pingtreetargets/{targetId}  -> full target object
 *   3) replace criteria[*].bulkCriteria.id with the new bulk tag id
 *   4) PATCH /pingtreetargets/{targetId} with the full object
 */

const ACCOUNT_ID =
  process.env.RINGBA_ACCOUNT_ID || "RAec22abec294c46ddba910daf69d8489c";
const BASE_HOST = (process.env.RINGBA_BULK_API_BASE || "https://api.ringba.com/v2").replace(
  /\/+$/,
  ""
);
// Falls back to the report-API token if a dedicated one isn't set.
const TOKEN = process.env.RINGBA_BULK_TOKEN || process.env.RINGBA_TOKEN || "";
const TIMEOUT_MS = Number(process.env.RINGBA_BULK_TIMEOUT_MS || 120000);

const BASE_URL = `${BASE_HOST}/${ACCOUNT_ID}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class RingbaUploadService {
  constructor() {
    this.maxRetries = Number(process.env.RINGBA_BULK_MAX_RETRIES || 3);
    this.baseRetryDelayMs = Number(process.env.RINGBA_BULK_RETRY_DELAY_MS || 1000);

    this.http = axios.create({
      baseURL: BASE_URL,
      timeout: TIMEOUT_MS,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      validateStatus: (s) => s >= 200 && s < 300,
    });
  }

  _assertToken() {
    if (!TOKEN) {
      throw new Error("Missing Ringba token — set RINGBA_BULK_TOKEN or RINGBA_TOKEN");
    }
  }

  _headers() {
    return { Authorization: `Token ${TOKEN}` };
  }

  async _request(method, path, body) {
    this._assertToken();

    let attempt = 0;
    let lastErr = null;

    while (attempt < this.maxRetries) {
      attempt++;
      try {
        const res = await this.http.request({
          method,
          url: path,
          data: body,
          headers: this._headers(),
        });
        return res.data;
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          "Unknown error";

        if (status === 401 || status === 403) {
          logger.error(`[ringbaUpload] ${status} on ${method} ${path}: ${msg}`);
          throw err;
        }

        const delay = this.baseRetryDelayMs * Math.pow(2, attempt - 1);
        logger.error(
          `[ringbaUpload] ${method} ${path} attempt ${attempt}/${this.maxRetries} failed` +
            (status ? ` (status ${status})` : "") +
            `: ${msg}. Retrying in ${delay}ms`
        );
        if (attempt >= this.maxRetries) break;
        await sleep(delay);
      }
    }
    throw lastErr || new Error("Ringba bulk request failed");
  }

  /**
   * STEP 1 — Create a new Bulk Tag from a list of numbers.
   * @returns {Promise<{ id:string, name:string, tagCount:number }>}
   */
  async uploadBulkTag(name, numbers) {
    const csv_list = (Array.isArray(numbers) ? numbers : [])
      .map((n) => String(n).trim())
      .filter(Boolean)
      .join("\n");

    if (!csv_list) throw new Error("uploadBulkTag: no numbers to upload");

    const data = await this._request("POST", "/bulkTags", { name, csv_list });
    const upload = data?.bulkTagUpload || {};
    if (!upload.id) {
      throw new Error("uploadBulkTag: response did not include bulkTagUpload.id");
    }

    logger.info(
      `[ringbaUpload] Bulk tag created id=${upload.id} name="${name}" tagCount=${upload.tagCount}`
    );
    return upload;
  }

  /** STEP 3 — Get the full ping-tree target object. */
  async getPingTreeTarget(targetId) {
    const data = await this._request("GET", `/pingtreetargets/${targetId}`);
    // GET may return the object directly or wrapped under pingTreeTarget.
    return data?.pingTreeTarget || data;
  }

  /** STEP 5 — Persist the modified target object. */
  async patchPingTreeTarget(targetId, targetObject) {
    const data = await this._request(
      "PATCH",
      `/pingtreetargets/${targetId}`,
      targetObject
    );
    return data?.pingTreeTarget || data;
  }

  /**
   * Replace every criteria[*].bulkCriteria.id on the target with the
   * new bulk tag id. Returns the number of bulkCriteria entries changed.
   */
  _replaceBulkCriteriaId(target, newBulkTagId) {
    let replaced = 0;
    const criteria = Array.isArray(target?.criteria) ? target.criteria : [];
    for (const c of criteria) {
      if (c && c.bulkCriteria && typeof c.bulkCriteria === "object") {
        c.bulkCriteria.id = newBulkTagId;
        replaced++;
      }
    }
    return replaced;
  }

  /**
   * Full flow: upload a bulk tag, then point a ping-tree target at it.
   *
   * @param {{ targetId:string, name:string, numbers:string[] }} args
   * @returns {Promise<{ bulkTagId:string, tagCount:number, criteriaReplaced:number }>}
   */
  async uploadAndAssign({ targetId, name, numbers }) {
    if (!targetId) throw new Error("uploadAndAssign: targetId is required");

    const upload = await this.uploadBulkTag(name, numbers);

    const target = await this.getPingTreeTarget(targetId);
    if (!target || !target.id) {
      throw new Error(`Ping-tree target ${targetId} not found`);
    }

    const replaced = this._replaceBulkCriteriaId(target, upload.id);
    if (replaced === 0) {
      throw new Error(
        `Target ${targetId} has no bulkCriteria entry to update — check the target config`
      );
    }

    await this.patchPingTreeTarget(targetId, target);

    logger.info(
      `[ringbaUpload] Target ${targetId} updated -> bulkTag ${upload.id} (${replaced} criteria replaced)`
    );

    return {
      bulkTagId: upload.id,
      tagCount: upload.tagCount || (numbers ? numbers.length : 0),
      criteriaReplaced: replaced,
    };
  }
}

module.exports = new RingbaUploadService();
