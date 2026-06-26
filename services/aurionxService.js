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

const MAX_CONCURRENT = Number(process.env.AURIONX_CONCURRENCY) || 120;
// The API is slow (~3-4s/call); 4s cut off near-complete requests and
// (worse) marked them not-duplicate. Give them room, and retry timeouts.
const TIMEOUT_MS = Number(process.env.AURIONX_TIMEOUT_MS) || 12000;
const MAX_RETRIES = Number(process.env.AURIONX_MAX_RETRIES) || 2;
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

function isTransient(err) {
  return (
    err?.code === "ECONNABORTED" ||
    /timeout/i.test(err?.message || "") ||
    !err?.response // network error, no HTTP response
  );
}

// Returns { isDup, ok } — ok=false means the lookup failed (cached as
// not-duplicate so it never blocks, but counted so we can report it).
async function _check(phone) {
  const cached = getCached(phone);
  if (cached !== null) return { isDup: cached, ok: true, cached: true };

  const url = `${BASE_URL}/campaignKey/${CAMPAIGN_KEY}?searchBy=phone&searchValue=${encodeURIComponent(phone)}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await api.get(url);
      const isDup = isDuplicateResponse(data);
      setCached(phone, isDup);
      return { isDup, ok: true };
    } catch (err) {
      if (attempt < MAX_RETRIES && isTransient(err)) continue; // retry transient
      setCached(phone, false);
      return { isDup: false, ok: false, err: err?.message || String(err) };
    }
  }
}

async function checkNumber(phone) {
  return (await _check(phone)).isDup;
}

async function checkBatch(numbers) {
  const started = Date.now();
  const uniqueNumbers = [...new Set((numbers || []).filter(Boolean))];
  const dupSet = new Set();
  let errors = 0;
  let cacheHits = 0;

  await Promise.all(
    uniqueNumbers.map((num) =>
      pool.run(async () => {
        const r = await _check(num);
        if (r.cached) cacheHits++;
        if (!r.ok) errors++;
        if (r.isDup) dupSet.add(num);
      })
    )
  );

  logger.info(
    `[aurionx] batch=${uniqueNumbers.length} duplicates=${dupSet.size} errors=${errors} cacheHits=${cacheHits} ms=${Date.now() - started}`
  );
  return dupSet;
}

module.exports = { checkNumber, checkBatch };
