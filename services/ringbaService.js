"use strict";

const axios = require("axios");
const logger = require("../utils/logger");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assertEnv(name, value) {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

// digits-only, removes leading "+" and any non-digit chars
function normalizePhone(value) {
  if (!value) return "";
  const s = String(value).trim();
  const noPlus = s.startsWith("+") ? s.slice(1) : s;
  return noPlus.replace(/[^\d]/g, "");
}

class RingbaService {
  constructor() {
    this.url = process.env.RINGBA_API_URL;
    this.token = process.env.RINGBA_TOKEN;

    assertEnv("RINGBA_API_URL", this.url);
    assertEnv("RINGBA_TOKEN", this.token);

    this.maxRetries = Number(process.env.RINGBA_MAX_RETRIES || 3);
    this.baseRetryDelayMs = Number(process.env.RINGBA_RETRY_DELAY_MS || 800);
    this.timeoutMs = Number(process.env.RINGBA_TIMEOUT_MS || 20000);

    this.http = axios.create({
      timeout: this.timeoutMs,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
  }

  _authHeaders() {
    return { Authorization: `Token ${this.token}` };
  }

  _validateDateRange(dateRange) {
    if (!dateRange?.startDate || !dateRange?.endDate) {
      throw new Error("dateRange.startDate and dateRange.endDate are required");
    }
    if (!(dateRange.startDate instanceof Date) || isNaN(dateRange.startDate)) {
      throw new Error("dateRange.startDate must be a valid Date");
    }
    if (!(dateRange.endDate instanceof Date) || isNaN(dateRange.endDate)) {
      throw new Error("dateRange.endDate must be a valid Date");
    }
  }

  // AND group with 1 condition
  _group(cond) {
    return {
      anyConditionToMatch: [
        {
          column: String(cond.column),
          value: String(cond.value),
          isNegativeMatch: Boolean(cond.isNegativeMatch || false),
          comparisonType: String(cond.comparisonType),
        },
      ],
    };
  }

  // OR group with multiple conditions (anyConditionToMatch)
  _orGroup(conditions) {
    return {
      anyConditionToMatch: (conditions || []).map((c) => ({
        column: String(c.column),
        value: String(c.value),
        isNegativeMatch: Boolean(c.isNegativeMatch || false),
        comparisonType: String(c.comparisonType),
      })),
    };
  }

  /**
   * Low-level fetch with offset/size (may cap around ~10k depending on Ringba backend).
   */
  async fetchReportPaged(args) {
    const reportStart = args?.reportStart;
    const reportEnd = args?.reportEnd;

    if (!(reportStart instanceof Date) || isNaN(reportStart)) {
      throw new Error("reportStart must be a valid Date");
    }
    if (!(reportEnd instanceof Date) || isNaN(reportEnd)) {
      throw new Error("reportEnd must be a valid Date");
    }

    const size = Number(args.size || process.env.RINGBA_PAGE_SIZE || 1000);
    const valueColumns = Array.isArray(args.valueColumns) ? args.valueColumns : [];
    const filters = Array.isArray(args.filters) ? args.filters : [];

    let offset = 0;
    let totalCount = null;
    const allRecords = [];

    for (;;) {
      const data = await this._fetchReportPage({
        reportStart,
        reportEnd,
        valueColumns,
        filters,
        size,
        offset,
      });

      if (!data || data.isSuccessful !== true) {
        const msg = data?.message || data?.error || "Ringba response is not successful";
        throw new Error(msg);
      }

      const report = data.report || {};
      const records = Array.isArray(report.records) ? report.records : [];

      if (totalCount === null) {
        totalCount = typeof report.totalCount === "number" ? report.totalCount : null;
      }

      allRecords.push(...records);

      if (records.length === 0) break;

      offset += size;

      if (typeof totalCount === "number" && offset >= totalCount) break;

      if (offset > 5_000_000) {
        throw new Error("Ringba paging safety stop (offset too large).");
      }
    }

    return { records: allRecords, totalCount };
  }

  /**
   * Generic “campaign contains” (server-side filters).
   * Note: use chunked wrapper for big volumes.
   */
  async fetchNumbersForCampaign(campaignContains, dateRange, callLengthMinSeconds, opts = {}) {
    if (!campaignContains) throw new Error("campaignContains is required");
    this._validateDateRange(dateRange);

    const filters = [];

    // campaignName CONTAINS X (default)
    filters.push(
      this._group({
        column: "campaignName",
        value: campaignContains,
        comparisonType: opts.campaignComparisonType || "CONTAINS",
      })
    );

    if (callLengthMinSeconds && Number(callLengthMinSeconds) > 0) {
      filters.push(
        this._group({
          column: "callLengthInSeconds",
          value: String(Number(callLengthMinSeconds)),
          comparisonType: "GREATER_THAN",
        })
      );
    }

    if (opts.hasPayout === true) {
      filters.push(
        this._group({
          column: "hasPayout",
          value: "yes",
          comparisonType: "EQUALS",
        })
      );
    }

    if (Array.isArray(opts.extraFilters) && opts.extraFilters.length) {
      filters.push(...opts.extraFilters);
    }

    const valueColumns = Array.isArray(opts.valueColumns)
      ? opts.valueColumns
      : [{ column: "campaignName" }, { column: "inboundPhoneNumber" }];

    const { records, totalCount } = await this.fetchReportPaged({
      reportStart: dateRange.startDate,
      reportEnd: dateRange.endDate,
      valueColumns,
      filters,
      size: Number(opts.size || process.env.RINGBA_PAGE_SIZE || 1000),
    });

    const numbers = [];
    for (const rec of records) {
      const num = normalizePhone(rec?.inboundPhoneNumber);
      if (num) numbers.push(num);
    }

    return { numbers, fetchedCount: numbers.length, totalCount };
  }

  /**
   * ✅ Chunked wrapper to bypass ~10k cap.
   * Use for large campaigns (70–80k).
   */
  async fetchNumbersForCampaignChunked(campaignContains, dateRange, callLengthMinSeconds, opts = {}) {
    this._validateDateRange(dateRange);

    const maxSingleQueryRows = Number(opts.maxSingleQueryRows || 9000);
    const chunkDays = Math.max(1, Number(opts.chunkDays || 1)); // default 1 day for safety

    // First try single query for small datasets
    const first = await this.fetchNumbersForCampaign(campaignContains, dateRange, callLengthMinSeconds, opts);

    if (typeof first.totalCount === "number" && first.totalCount <= maxSingleQueryRows) {
      return first;
    }

    const all = [];
    let curStart = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);

    while (curStart <= end) {
      const curEnd = new Date(curStart);
      curEnd.setUTCDate(curEnd.getUTCDate() + chunkDays);
      if (curEnd > end) curEnd.setTime(end.getTime());

      const slice = await this.fetchNumbersForCampaign(
        campaignContains,
        { startDate: curStart, endDate: curEnd },
        callLengthMinSeconds,
        opts
      );

      if (slice?.numbers?.length) all.push(...slice.numbers);

      curStart = new Date(curEnd.getTime() + 1); // avoid overlap
    }

    return { numbers: all, fetchedCount: all.length, totalCount: null };
  }
  async fetchNumbersForExactCampaignNamesChunked(campaignNames, dateRange, callLengthMinSeconds, opts = {}) {
    if (!Array.isArray(campaignNames) || campaignNames.length === 0) {
      throw new Error("campaignNames[] is required");
    }
    this._validateDateRange(dateRange);

    const chunkDays = Math.max(1, Number(opts.chunkDays || 1));
    const orCampaign = this._orGroup(
      campaignNames.map((name) => ({
        column: "campaignName",
        value: name,
        comparisonType: "EQUALS",
      }))
    );

    const extraFilters = Array.isArray(opts.extraFilters) ? [...opts.extraFilters] : [];
    extraFilters.unshift(orCampaign);


    const valueColumns = [
      { column: "campaignName" },         
      { column: "inboundPhoneNumber" },   
    ];

    const all = [];
    let curStart = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);

    while (curStart <= end) {
      const curEnd = new Date(curStart);
      curEnd.setUTCDate(curEnd.getUTCDate() + chunkDays);
      if (curEnd > end) curEnd.setTime(end.getTime());

      const filters = [...extraFilters];

      if (callLengthMinSeconds && Number(callLengthMinSeconds) > 0) {
        filters.push(
          this._group({
            column: "callLengthInSeconds",
            value: String(Number(callLengthMinSeconds)),
            comparisonType: "GREATER_THAN",
          })
        );
      }

      if (opts.hasPayout === true) {
        filters.push(
          this._group({
            column: "hasPayout",
            value: "yes",
            comparisonType: "EQUALS",
          })
        );
      }

      const { records } = await this.fetchReportPaged({
        reportStart: curStart,
        reportEnd: curEnd,
        valueColumns,
        filters,
        size: Number(opts.size || process.env.RINGBA_PAGE_SIZE || 1000),
      });

      for (const rec of records) {
        const num = normalizePhone(rec?.inboundPhoneNumber);
        if (num) all.push(num);
      }

      curStart = new Date(curEnd.getTime() + 1);
    }

    return { numbers: all, fetchedCount: all.length, totalCount: null };
  }

  async _fetchReportPage({ reportStart, reportEnd, valueColumns, filters, size, offset }) {
    const body = {
      reportStart: reportStart.toISOString(),
      reportEnd: reportEnd.toISOString(),
      valueColumns,
      filters,
      size,
      offset,
    };

    const headers = this._authHeaders();

    let attempt = 0;
    let lastErr = null;

    while (attempt < this.maxRetries) {
      attempt++;
      try {
        const res = await this.http.post(this.url, body, { headers });
        return res.data;
      } catch (err) {
        lastErr = err;

        const status = err?.response?.status;
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          "Unknown error";

        if (status === 401) {
          logger.error(`Ringba 401 Unauthorized. ${msg}`);
          throw err;
        }

        const delay =
          this.baseRetryDelayMs * Math.min(8, Math.pow(2, attempt - 1)) +
          Math.floor(Math.random() * 150);

        logger.error(
          `Ringba API attempt ${attempt}/${this.maxRetries} failed` +
            (status ? ` (status ${status})` : "") +
            `: ${msg}. Retrying in ${delay}ms`
        );

        if (attempt >= this.maxRetries) break;
        await sleep(delay);
      }
    }

    throw lastErr || new Error("Ringba request failed");
  }
}

module.exports = new RingbaService();
module.exports.normalizePhone = normalizePhone;