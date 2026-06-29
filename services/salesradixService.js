"use strict";

/**
 * SalesRadix agent-availability check (IdealConcepts buyer endpoint).
 *
 * Per number:
 *   GET {BASE}?PhoneNumber={n}&Vertical={V}&SubSourceID={S}&State={ST}&ResponseType=json
 *   -> { "errors": [], "result": "Available" | "Rejected - Duplicate" | ... }
 *
 * A number is a duplicate when `result` contains "duplicate" (case-insensitive).
 *
 * NOTE: this re-queries CURRENT availability, which can differ from the
 * historical ring-tree response at call time. TTL cache + bounded
 * concurrency; failures are returned as ok=false (not duplicate).
 *
 * Env: SALESRADIX_API_BASE, SALESRADIX_VERTICAL, SALESRADIX_SUBSOURCE_ID,
 *      SALESRADIX_STATE, SALESRADIX_RESPONSE_TYPE, SALESRADIX_CONCURRENCY,
 *      SALESRADIX_TIMEOUT_MS, SALESRADIX_MAX_RETRIES, SALESRADIX_CACHE_TTL_MS
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const logger = require("../utils/logger");

const BASE_URL = process.env.SALESRADIX_API_BASE || "https://api.salesradix.com/agentavailability";
const VERTICAL = process.env.SALESRADIX_VERTICAL || "Health";
const SUBSOURCE_ID = process.env.SALESRADIX_SUBSOURCE_ID || "3898";
const STATE = process.env.SALESRADIX_STATE || "GA";
const RESPONSE_TYPE = process.env.SALESRADIX_RESPONSE_TYPE || "json";

const MAX_CONCURRENT = Number(process.env.SALESRADIX_CONCURRENCY) || 50;
const TIMEOUT_MS = Number(process.env.SALESRADIX_TIMEOUT_MS) || 8000;
const MAX_RETRIES = Number(process.env.SALESRADIX_MAX_RETRIES) || 1;
const CACHE_TTL_MS = Number(process.env.SALESRADIX_CACHE_TTL_MS) || 30 * 60 * 1000;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: MAX_CONCURRENT });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: MAX_CONCURRENT });

const api = axios.create({
  timeout: TIMEOUT_MS,
  httpAgent,
  httpsAgent,
  headers: { Accept: "application/json" },
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
const cache = new Map();

function getCached(phone) {
  const e = cache.get(phone);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    cache.delete(phone);
    return null;
  }
  return e;
}

function isTransient(err) {
  return err?.code === "ECONNABORTED" || /timeout/i.test(err?.message || "") || !err?.response;
}

// Returns { result, isDup, ok }.
async function _check(phone, state) {
  const st = state || STATE;
  const key = `${phone}|${st}`;
  const cached = getCached(key);
  if (cached) return { result: cached.result, isDup: cached.isDup, ok: cached.ok };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await api.get(BASE_URL, {
        params: {
          PhoneNumber: phone,
          Vertical: VERTICAL,
          SubSourceID: SUBSOURCE_ID,
          State: st,
          ResponseType: RESPONSE_TYPE,
        },
      });
      const result = typeof data?.result === "string" ? data.result : "";
      const isDup = /duplicate/i.test(result);
      cache.set(key, { result, isDup, ok: true, expiresAt: Date.now() + CACHE_TTL_MS });
      return { result, isDup, ok: true };
    } catch (err) {
      if (attempt < MAX_RETRIES && isTransient(err)) continue;
      cache.set(key, { result: "ERROR", isDup: false, ok: false, expiresAt: Date.now() + CACHE_TTL_MS });
      return { result: `ERROR: ${err?.message || err}`, isDup: false, ok: false };
    }
  }
}

async function checkNumber(phone, state) {
  return _check(phone, state);
}

/**
 * @param {string[]} numbers
 * @param {{ state?:string, stateFor?:(n:string)=>string, onProgress?:(done:number,total:number)=>void }} opts
 *   stateFor(number) returns that number's 2-letter state (overrides `state`).
 * @returns {Promise<{ dupSet:Set<string>, results:Map<string,string>, states:Map<string,string> }>}
 */
async function checkBatch(numbers, { state, stateFor, onProgress } = {}) {
  const unique = [...new Set((numbers || []).filter(Boolean))];
  const dupSet = new Set();
  const results = new Map();
  const states = new Map();
  let done = 0;
  let errors = 0;

  await Promise.all(
    unique.map((n) =>
      pool.run(async () => {
        const st = (typeof stateFor === "function" ? stateFor(n) : state) || STATE;
        states.set(n, st);
        const r = await _check(n, st);
        results.set(n, r.result);
        if (!r.ok) errors++;
        if (r.isDup) dupSet.add(n);
        done++;
        if (typeof onProgress === "function" && (done % 25 === 0 || done === unique.length)) {
          onProgress(done, unique.length);
        }
      })
    )
  );

  logger.info(`[salesradix] checked=${unique.length} duplicates=${dupSet.size} errors=${errors}`);
  return { dupSet, results, states };
}

module.exports = { checkNumber, checkBatch };
