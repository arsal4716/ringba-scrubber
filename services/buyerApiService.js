"use strict";

const axios = require("axios");
const http = require("http");
const https = require("https");
const logger = require("../utils/logger");

const BUYER_API_BASE = "https://hcs.tldcrm.com/api/public/dialer/ready";
const QUI = process.env.BUYER_API_QUI || "27053";
const ADG = process.env.BUYER_API_ADG || "true";
const MAX_CONCURRENT = Number(process.env.BUYER_API_CONCURRENCY) || 75;

const TIMEOUT_MS = Number(process.env.BUYER_API_TIMEOUT_MS) || 2500;

const CACHE_TTL_MS = Number(process.env.BUYER_API_CACHE_TTL_MS) || 30 * 60 * 1000;

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: MAX_CONCURRENT,
  maxFreeSockets: Math.min(25, MAX_CONCURRENT),
  timeout: TIMEOUT_MS,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: MAX_CONCURRENT,
  maxFreeSockets: Math.min(25, MAX_CONCURRENT),
  timeout: TIMEOUT_MS,
});

const api = axios.create({
  timeout: TIMEOUT_MS,
  httpAgent,
  httpsAgent,
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
          if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
          }
        }
      };

      if (this.running < this.limit) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }
}

const pool = new ConcurrentPool(MAX_CONCURRENT);

const resultCache = new Map();

function getCached(phone10) {
  const entry = resultCache.get(phone10);
  if (!entry) return null;

  if (entry.expiresAt < Date.now()) {
    resultCache.delete(phone10);
    return null;
  }

  return entry.isDup;
}

function setCached(phone10, isDup) {
  resultCache.set(phone10, {
    isDup: Boolean(isDup),
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}
async function checkNumber(phone10) {
  const cached = getCached(phone10);
  if (cached !== null) {
    return cached;
  }

  const url = `${BUYER_API_BASE}/${phone10}?qui=${QUI}&adg=${ADG}`;
  const started = Date.now();

  try {
    const res = await api.get(url);
    const isDup = res.data?.ready === 0;
    setCached(phone10, isDup);

    logger.info(
      `[buyerApi] phone=${phone10} ready=${res.data?.ready} duplicate=${isDup} ms=${Date.now() - started}`
    );

    return isDup;
  } catch (err) {
    logger.error(
      `[buyerApi] error phone=${phone10} ms=${Date.now() - started} err=${err?.message || err}`
    );
    setCached(phone10, false);
    return false;
  }
}

async function checkBatch(numbers10) {
  const started = Date.now();

  const uniqueNumbers = [...new Set((numbers10 || []).filter(Boolean))];
  const dupSet = new Set();

  let cacheHits = 0;
  let apiChecks = 0;

  await Promise.all(
    uniqueNumbers.map((num) =>
      pool.run(async () => {
        const cached = getCached(num);
        if (cached !== null) {
          cacheHits++;
          if (cached) dupSet.add(num);
          return;
        }

        apiChecks++;
        const isDup = await checkNumber(num);
        if (isDup) dupSet.add(num);
      })
    )
  );

  return dupSet;
}

module.exports = {
  checkNumber,
  checkBatch,
};