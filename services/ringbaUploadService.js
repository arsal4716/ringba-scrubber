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

        if (status === 401 || status === 403 || status === 404) {
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

  /**
   * Ringba has two kinds of targets and they live at different paths:
   *   TA… → simple target          → /targets/{id}
   *   PI… → ping-tree target group  → /pingtreetargets/{id}
   * Hitting the wrong one returns 404, so route by the ID prefix.
   */
  _targetPath(targetId) {
    const kind = /^TA/i.test(targetId) ? "targets" : "pingtreetargets";
    return `/${kind}/${targetId}`;
  }

  /** STEP 3 — Get the full target object (simple or ping-tree). */
  async getTarget(targetId) {
    const data = await this._request("GET", this._targetPath(targetId));
    // GET may return the object directly or wrapped under a type key.
    return data?.pingTreeTarget || data?.target || data;
  }

  /** STEP 5 — Persist the modified target object. */
  async patchTarget(targetId, targetObject) {
    const data = await this._request(
      "PATCH",
      this._targetPath(targetId),
      targetObject
    );
    return data?.pingTreeTarget || data?.target || data;
  }

  /**
   * Replace every criteria[*].bulkCriteria tag id on the target with the
   * new bulk tag id. Ping-tree targets key it as `id`, simple targets as
   * `Id` — update whichever is present so the swap actually sticks.
   * Returns the number of bulkCriteria entries changed.
   */
  _replaceBulkCriteriaId(target, newBulkTagId) {
    let replaced = 0;
    const criteria = Array.isArray(target?.criteria) ? target.criteria : [];
    for (const c of criteria) {
      const bc = c && c.bulkCriteria;
      if (bc && typeof bc === "object") {
        if ("Id" in bc) bc.Id = newBulkTagId;
        if ("id" in bc) bc.id = newBulkTagId;
        if (!("id" in bc) && !("Id" in bc)) bc.id = newBulkTagId;
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

    const target = await this.getTarget(targetId);
    if (!target || !target.id) {
      throw new Error(`Target ${targetId} not found`);
    }

    const replaced = this._replaceBulkCriteriaId(target, upload.id);
    if (replaced === 0) {
      throw new Error(
        `Target ${targetId} has no bulkCriteria entry to update — check the target config`
      );
    }

    await this.patchTarget(targetId, target);

    logger.info(
      `[ringbaUpload] Target ${targetId} updated -> bulkTag ${upload.id} (${replaced} criteria replaced)`
    );

    return {
      bulkTagId: upload.id,
      tagCount: upload.tagCount || (numbers ? numbers.length : 0),
      criteriaReplaced: replaced,
    };
  }

  /**
   * Multi-criteria flow: a single target with several bulkCriteria slots,
   * each pointed at a DIFFERENT bulk tag.
   *
   * @param {{ targetId:string, assignments: Array<{name:string, numbers:string[]}> }} args
   *   assignments[i] is uploaded as a bulk tag and assigned to the i-th
   *   bulkCriteria slot (document order). Extra slots reuse the last tag.
   */
  async uploadAndAssignMulti({ targetId, assignments }) {
    if (!targetId) throw new Error("uploadAndAssignMulti: targetId is required");
    if (!Array.isArray(assignments) || !assignments.length) {
      throw new Error("uploadAndAssignMulti: assignments are required");
    }

    // Upload each file as its own bulk tag.
    const uploads = [];
    for (const a of assignments) {
      uploads.push(await this.uploadBulkTag(a.name, a.numbers));
    }
    const tagIds = uploads.map((u) => u.id);

    const target = await this.getTarget(targetId);
    if (!target || !target.id) throw new Error(`Target ${targetId} not found`);

    const slots = (Array.isArray(target.criteria) ? target.criteria : [])
      .map((c) => c && c.bulkCriteria)
      .filter((bc) => bc && typeof bc === "object");

    if (!slots.length) {
      throw new Error(`Target ${targetId} has no bulkCriteria entry to update`);
    }
    if (slots.length !== tagIds.length) {
      logger.warn(
        `[ringbaUpload] Target ${targetId} has ${slots.length} bulkCriteria but ${tagIds.length} files — assigning by index`
      );
    }

    slots.forEach((bc, i) => {
      const tagId = tagIds[i] !== undefined ? tagIds[i] : tagIds[tagIds.length - 1];
      if ("Id" in bc) bc.Id = tagId;
      if ("id" in bc) bc.id = tagId;
      if (!("id" in bc) && !("Id" in bc)) bc.id = tagId;
    });

    await this.patchTarget(targetId, target);

    logger.info(
      `[ringbaUpload] Target ${targetId} multi-assigned ${slots.length} criteria -> tags [${tagIds.join(", ")}]`
    );

    return {
      bulkTagIds: tagIds,
      tagCount: uploads.reduce((s, u) => s + (u.tagCount || 0), 0),
      criteriaAssigned: slots.length,
    };
  }
}

module.exports = new RingbaUploadService();
