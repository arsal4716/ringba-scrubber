"use strict";

const axios = require("axios");
const logger = require("../utils/logger");

const BUYER_API_BASE = "https://hcs.tldcrm.com/api/public/dialer/ready";
const QUI = process.env.BUYER_API_QUI || "27053";
const ADG = process.env.BUYER_API_ADG || "true";
const MAX_CONCURRENT = Number(process.env.BUYER_API_CONCURRENCY) || 10;
const TIMEOUT_MS = Number(process.env.BUYER_API_TIMEOUT_MS) || 5000;

// ─── Simple concurrency pool ──────────────────────────────────
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
            this.queue.shift()();
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

/**
 * Check a single number against the buyer API.
 * Returns true if the number is a DUPLICATE (ready === 0).
 */
async function checkNumber(phone10) {
  const url = `${BUYER_API_BASE}/${phone10}?qui=${QUI}&adg=${ADG}`;
  try {
    const res = await axios.get(url, {
      timeout: TIMEOUT_MS,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    // {"ready":0} → duplicate, {"ready":1} → not duplicate
    return res.data?.ready === 0;
  } catch (err) {
    logger.error(`Buyer API error for ${phone10}: ${err?.message || err}`);
    // On error: assume NOT duplicate to avoid false positives
    return false;
  }
}

/**
 * Check a batch of 10-digit numbers against the buyer API.
 * Returns a Set of numbers that are duplicates (ready === 0).
 *
 * Uses ConcurrentPool to limit to MAX_CONCURRENT simultaneous requests.
 */
async function checkBatch(numbers10) {
  const dupSet = new Set();

  await Promise.all(
    numbers10.map((num) =>
      pool.run(async () => {
        const isDup = await checkNumber(num);
        if (isDup) dupSet.add(num);
      })
    )
  );

  return dupSet;
}

module.exports = { checkNumber, checkBatch };
