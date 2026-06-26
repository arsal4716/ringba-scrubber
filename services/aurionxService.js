"use strict";

/**
 * Aurionx buyer-dedup API (used for SSDI scrubs).
 *
 * Per number:
 *   GET {BASE}/campaignKey/{KEY}?searchBy=phone&searchValue={phone}
 *   header: x-api-key: {API_KEY}
 *
 * A number is a duplicate when leadExists is true, or any of the
 * ssdiApiDuplicatePing flags (kdMatterMessage / premierDuplicate /
 * trajectorDuplicate) are true.
 *
 * Mirrors buyerApiService: in-memory TTL cache + bounded concurrency, and
 * exposes checkBatch(numbers10) -> Set of duplicate numbers. Failures are
 * cached as "not duplicate" so one bad lookup never blocks a scrub.
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const logger = require("../utils/logger");

const BASE_URL =
  process.env.AURIONX_API_BASE || "https://api.aurionx.ai/api/vendors/leads/check";
const CAMPAIGN_KEY =
  process.env.AURIONX_CAMPAIGN_KEY || "c2cc5f885d2a3790c85b9c1bde3fa2c3";
const API_KEY = process.env.AURIONX_API_KEY || "kdmr5";

const MAX_CONCURRENT = Number(process.env.AURIONX_CONCURRENCY) || 50;
const TIMEOUT_MS = Number(process.env.AURIONX_TIMEOUT_MS) || 4000;
const CACHE_TTL_MS = Number(process.env.AURIONX_CACHE_TTL_MS) || 30 * 60 * 1000;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: MAX_CONCURRENT });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: MAX_CONCURRENT });

const api = axios.create({
  timeout: TIMEOUT_MS,
  httpAgent,
  httpsAgent,
  headers: { "x-api-key": API_KEY, Accept: "application/json" },
  validateStatus: (s) => s >= 200 && s < 300,
});

class ConcurrentPool {
  constructor(limit) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
  }
  run(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.running++;
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          if (this.queue.length > 0) this.queue.shift()();
        }
      };
      if (this.running < this.limit) execute();
      else this.queue.push(execute);
    });
  }
}

const pool = new ConcurrentPool(MAX_CONCURRENT);
const resultCache = new Map();

function getCached(phone) {
  const entry = resultCache.get(phone);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    resultCache.delete(phone);
    return null;
  }
  return entry.isDup;
}

function setCached(phone, isDup) {
  resultCache.set(phone, { isDup: Boolean(isDup), expiresAt: Date.now() + CACHE_TTL_MS });
}

function isDuplicateResponse(data) {
  const p = data?.ssdiApiDuplicatePing || {};
  return (
    data?.leadExists === true ||
    p["Lead.kdMatterMessage"] === true ||
    p["Lead.premierDuplicate"] === true ||
    p["Lead.trajectorDuplicate"] === true
  );
}

async function checkNumber(phone) {
  const cached = getCached(phone);
  if (cached !== null) return cached;

  const url = `${BASE_URL}/campaignKey/${CAMPAIGN_KEY}?searchBy=phone&searchValue=${encodeURIComponent(phone)}`;
  const started = Date.now();

  try {
    const { data } = await api.get(url);
    const isDup = isDuplicateResponse(data);
    setCached(phone, isDup);
    logger.info(`[aurionx] phone=${phone} duplicate=${isDup} ms=${Date.now() - started}`);
    return isDup;
  } catch (err) {
    logger.error(`[aurionx] error phone=${phone} ms=${Date.now() - started} err=${err?.message || err}`);
    setCached(phone, false);
    return false;
  }
}

async function checkBatch(numbers) {
  const uniqueNumbers = [...new Set((numbers || []).filter(Boolean))];
  const dupSet = new Set();

  await Promise.all(
    uniqueNumbers.map((num) =>
      pool.run(async () => {
        const isDup = await checkNumber(num);
        if (isDup) dupSet.add(num);
      })
    )
  );

  return dupSet;
}

module.exports = { checkNumber, checkBatch };
