"use strict";

const cron = require("node-cron");
const moment = require("moment-timezone");

const Job = require("../models/Job");
const Call = require("../models/Call");
const Target = require("../models/Target");

const jobService = require("../services/jobService");
const ringbaService = require("../services/ringbaService");
const qcToolsService = require("../services/qcToolsService");
const callGridService = require("../services/callGridService");
const ringbaUploadService = require("../services/ringbaUploadService");
const googleSheetsService = require("../services/googleSheetsService");
const fileService = require("../services/fileService");

const { PRODUCTS, ACTIVE_PRODUCTS, SPECIAL_TARGETS } = require("../config/constants");
const { filterDNC } = require("../utils/dncFilter");
const { deduplicateNumbers } = require("../utils/dedupHelper");
const { getTodayInTimezone } = require("../utils/dateHelpers");
const logger = require("../utils/logger");

let scheduledTask = null;

function buildCronExpr(runTime, timezone) {
  const tzMoment = moment.tz(runTime, timezone);
  const minute = tzMoment.minute();
  const hour = tzMoment.hour();
  return { cronExpr: `${minute} ${hour} * * *`, hour, minute };
}

function computeNextRunFromSchedule(timeOfDayDate, timezone, fromDate = new Date()) {
  const mNow = moment.tz(fromDate, timezone);
  const mBase = moment.tz(timeOfDayDate, timezone);
  const next = mNow
    .clone()
    .hour(mBase.hour())
    .minute(mBase.minute())
    .second(0)
    .millisecond(0);

  if (next.isSameOrBefore(mNow)) next.add(1, "day");
  return next.toDate();
}

/**
 * Normalize phone for DB save + file output. Output is 10-digit US local.
 */
function normalizePhone(value) {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

/** Build a date range of the last `days` days in the given timezone. */
function lastDaysRange(timezone, days) {
  const today = getTodayInTimezone(timezone);
  return {
    startDate: today.clone().subtract(Number(days) || 30, "days").toDate(),
    endDate: today.clone().endOf("day").toDate(),
  };
}

/**
 * Replace the DB snapshot for one (product, source) pair.
 */
async function replaceCallsSnapshot({ campaignName, fetchType, numbers, runId }) {
  const normalized = (numbers || []).map(normalizePhone).filter(Boolean);
  const attempted = normalized.length;

  // The source feeds can repeat the same number within one product/source,
  // but (phoneNumber, campaignName, fetchType) is uniquely indexed — dedupe
  // here so insertMany doesn't blow up with an E11000 duplicate key error.
  const cleaned = [...new Set(normalized)];
  const duplicates = attempted - cleaned.length;

  await Call.deleteMany({ campaignName, fetchType });

  if (!cleaned.length) {
    logger.warn(
      `[snapshot] product=${campaignName} source=${fetchType} no numbers after cleanup`
    );
    return { attempted, inserted: 0 };
  }

  if (duplicates > 0) {
    logger.warn(
      `[snapshot] product=${campaignName} source=${fetchType} dropped ${duplicates} duplicate numbers`
    );
  }

  const docs = cleaned.map((phoneNumber) => ({
    phoneNumber,
    campaignName,
    fetchType,
    runId,
    fetchedAt: new Date(),
    createdAt: new Date(),
  }));

  const BATCH = 2000;
  let inserted = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    try {
      const res = await Call.collection.insertMany(batch, { ordered: false });
      inserted += res?.insertedCount || batch.length;
    } catch (err) {
      // ordered:false keeps inserting past dup keys; count what landed and
      // only treat non-duplicate errors as fatal.
      if (err.code === 11000) {
        inserted += err.result?.insertedCount || 0;
        logger.warn(
          `[snapshot] product=${campaignName} source=${fetchType} ignored duplicate keys in batch`
        );
      } else {
        throw err;
      }
    }
  }

  logger.info(`[snapshot] product=${campaignName} source=${fetchType} inserted=${inserted}`);
  return { attempted, inserted };
}

// ──────────────────────────────────────────────────────────────
// Per-source fetchers
// ──────────────────────────────────────────────────────────────

async function fetchRingbaSource(productKey, src, timezone) {
  const dateRange = lastDaysRange(timezone, src.days || 30);
  const out = await ringbaService.fetchNumbersForCampaignChunked(
    src.search,
    dateRange,
    null,
    { chunkDays: 1, hasPayout: src.paid === true }
  );
  return out.numbers || [];
}

async function fetchQcSource(productKey, src) {
  const out = await qcToolsService.fetchCallerIds({
    datePreset: src.datePreset || "last_6_months",
    disposition: src.disposition || "Sales",
    search: src.search || "",
  });
  return out.numbers || [];
}

async function fetchCallGridSource(productKey, src) {
  const out = await callGridService.fetchNumbers({
    days: src.days || 30,
    paid: src.paid === true,
    campaignIds: Array.isArray(src.campaignIds) ? src.campaignIds : [],
  });
  return out.numbers || [];
}

const SOURCE_FETCHERS = {
  ringba: (productKey, src, tz) => fetchRingbaSource(productKey, src, tz),
  qc: (productKey, src) => fetchQcSource(productKey, src),
  callgrid: (productKey, src) => fetchCallGridSource(productKey, src),
};

// Short, human-readable date-window tokens for QC date presets.
const QC_PRESET_LABEL = {
  last_6_months: "6mo",
  last_3_months: "3mo",
  last_year: "1y",
  last_30_days: "30d",
};

// Build a label describing where this product's numbers came from, e.g.
// "QC 6mo Sales + Ringba 30d paid" — used in the suppression file name.
function buildSourceLabel(product) {
  const parts = [];
  const s = product.sources || {};
  if (s.ringba?.enabled) {
    parts.push(`Ringba ${s.ringba.days || 30}d${s.ringba.paid ? " paid" : ""}`);
  }
  if (s.qc?.enabled) {
    const window = QC_PRESET_LABEL[s.qc.datePreset] || s.qc.datePreset || "";
    parts.push(`QC ${window} ${s.qc.disposition || ""}`.trim());
  }
  if (s.callgrid?.enabled) {
    parts.push(`CallGrid ${s.callgrid.days || 30}d${s.callgrid.paid ? " paid" : ""}`);
  }
  return parts.join(" + ");
}

/**
 * Build a dedicated suppression file for each special target mapped to
 * this product (see SPECIAL_TARGETS). Returns a Map keyed by Ringba
 * target id → { numbers, fileName }. Targets not in the map use the
 * normal combined product file.
 */
async function buildSpecialTargetFiles(productKey, timezone, dateStr) {
  const map = new Map();

  for (const [targetId, spec] of Object.entries(SPECIAL_TARGETS || {})) {
    if (spec.product !== productKey) continue;

    try {
      const days = (Number(spec.months) || 6) * 30;
      const dateRange = lastDaysRange(timezone, days);

      // Fetch calls TO the specific target (targetName), filtered to
      // long calls. Falls back to campaign search if no targetName set.
      const out = spec.targetName
        ? await ringbaService.fetchNumbersForTargetNameChunked(
            spec.targetName,
            dateRange,
            spec.callLengthMinSeconds || 0,
            { chunkDays: 7 }
          )
        : await ringbaService.fetchNumbersForCampaignChunked(
            spec.search,
            dateRange,
            spec.callLengthMinSeconds || 0,
            { chunkDays: 7, hasPayout: spec.paid === true }
          );

      const normalized = (out.numbers || []).map(normalizePhone).filter(Boolean);
      const unique = deduplicateNumbers(normalized);
      const finalNumbers = await filterDNC(unique);

      // e.g. "Ringba 6mo >180s"
      const label =
        `Ringba ${spec.months || 6}mo` +
        (spec.callLengthMinSeconds ? ` >${spec.callLengthMinSeconds}s` : "") +
        (spec.paid ? " paid" : "");

      const fileDoc = await fileService.generateProductFile(
        dateStr,
        productKey,
        finalNumbers,
        label,
        spec.label // file named after the target, e.g. ProHealthPartners-ACA-Xfers-CPL
      );

      map.set(targetId, {
        numbers: finalNumbers,
        fileName: fileDoc?.fileName || null,
      });

      logger.info(
        `[fetch] special target ${spec.label} (${targetId}) numbers=${finalNumbers.length} file="${fileDoc?.fileName}"`
      );
    } catch (err) {
      logger.error(
        `[fetch] special target ${spec.label} (${targetId}) build FAILED: ${err?.message || err}`
      );
    }
  }

  return map;
}

// ──────────────────────────────────────────────────────────────
// Process one product end-to-end.
// ──────────────────────────────────────────────────────────────
async function processProduct(productKey, timezone, runId, dateStr) {
  const product = PRODUCTS[productKey];
  if (!product) {
    logger.warn(`[fetch] Unknown product ${productKey}, skipping`);
    return null;
  }

  logger.info(`[fetch] ===== Product ${productKey} =====`);

  const sourceStats = [];
  const combinedRaw = [];

  for (const [sourceName, src] of Object.entries(product.sources || {})) {
    if (!src || src.enabled !== true) continue;

    const fetcher = SOURCE_FETCHERS[sourceName];
    if (!fetcher) {
      logger.warn(`[fetch] No fetcher for source=${sourceName}`);
      continue;
    }

    let numbers = [];
    try {
      numbers = await fetcher(productKey, src, timezone);
      logger.info(`[fetch] product=${productKey} source=${sourceName} fetched=${numbers.length}`);
    } catch (err) {
      logger.error(
        `[fetch] product=${productKey} source=${sourceName} FAILED: ${err?.message || err}`
      );
    }

    // Save a per-source DB snapshot.
    const saveRes = await replaceCallsSnapshot({
      campaignName: productKey,
      fetchType: sourceName,
      numbers,
      runId,
    });

    sourceStats.push({ source: sourceName, fetched: numbers.length, saved: saveRes.inserted });
    combinedRaw.push(...numbers);
  }

  // Combine -> normalize -> dedup -> DNC filter.
  const normalized = combinedRaw.map(normalizePhone).filter(Boolean);
  const unique = deduplicateNumbers(normalized);
  const finalNumbers = await filterDNC(unique);

  logger.info(
    `[fetch] product=${productKey} combined=${combinedRaw.length} unique=${unique.length} afterDNC=${finalNumbers.length}`
  );

  // Sync Google Sheet tab (ACA -> Database, SSDI -> SSDI).
  try {
    await googleSheetsService.writePhoneNumbersToTab(product.sheetTab, finalNumbers);
  } catch (err) {
    logger.error(`[fetch] Sheet sync failed product=${productKey}: ${err?.message || err}`);
  }

  // Generate the suppression TXT file.
  const sourceLabel = buildSourceLabel(product);
  const fileDoc = await fileService.generateProductFile(
    dateStr,
    productKey,
    finalNumbers,
    sourceLabel
  );

  // Build any dedicated per-target files (e.g. ProHealthPartners long calls).
  const specialFiles = await buildSpecialTargetFiles(productKey, timezone, dateStr);

  // Upload to every enabled Ringba target for this product.
  const targetResults = await uploadToTargets(
    productKey,
    finalNumbers,
    fileDoc?.fileName,
    dateStr,
    specialFiles
  );

  return {
    product: productKey,
    sourceStats,
    combined: combinedRaw.length,
    unique: unique.length,
    afterDNC: finalNumbers.length,
    fileName: fileDoc?.fileName || null,
    targets: targetResults,
  };
}

/**
 * Upload the final number list to each enabled Ringba target mapped
 * to this product, then update that target's status row.
 */
async function uploadToTargets(productKey, numbers, fileName, dateStr, specialFiles = new Map()) {
  const targets = await Target.find({ product: productKey, enabled: true });
  if (!targets.length) {
    logger.warn(`[fetch] No enabled Ringba targets for product=${productKey}`);
    return [];
  }

  const results = [];
  for (const t of targets) {
    const special = specialFiles.get(t.ringbaTargetId);
    const spec = SPECIAL_TARGETS[t.ringbaTargetId];

    // Dual-criteria target: one Ringba target with two bulk-tag slots —
    // assign the combined product file to one and the special file to the
    // other, per spec.dualAssign order.
    if (special && spec && Array.isArray(spec.dualAssign) && spec.dualAssign.length) {
      const sourceMap = {
        combined: { name: fileName || `${dateStr} – ${productKey}.txt`, numbers },
        special: { name: special.fileName, numbers: special.numbers },
      };
      const assignments = spec.dualAssign
        .map((k) => sourceMap[k])
        .filter((a) => a && a.numbers && a.numbers.length);

      try {
        const res = await ringbaUploadService.uploadAndAssignMulti({
          targetId: t.ringbaTargetId,
          assignments,
        });
        t.lastBulkTagId = (res.bulkTagIds || []).join(", ");
        t.lastUploadedCount = numbers.length;
        t.lastUploadedAt = new Date();
        t.lastStatus = "Success";
        t.lastError = null;
        await t.save();
        logger.info(
          `[fetch] Target "${t.name}" (${t.ringbaTargetId}) dual-assigned -> [${(res.bulkTagIds || []).join(", ")}]`
        );
        results.push({ target: t.name, status: "Success", bulkTagIds: res.bulkTagIds });
      } catch (err) {
        const msg = err?.message || String(err);
        t.lastStatus = "Failed";
        t.lastError = msg;
        t.lastUploadedAt = new Date();
        await t.save();
        logger.error(`[fetch] Target "${t.name}" dual-assign FAILED: ${msg}`);
        results.push({ target: t.name, status: "Failed", error: msg });
      }
      continue;
    }

    // Single-file targets: special ones get their own file/number list;
    // everyone else gets the standard combined product file.
    const useNumbers = special ? special.numbers : numbers;
    const bulkTagName =
      (special && special.fileName) ||
      fileName ||
      `${dateStr} – ${productKey} suppression.txt`;

    if (!useNumbers || !useNumbers.length) {
      logger.warn(`[fetch] Target "${t.name}" has 0 numbers — skipping`);
      t.lastStatus = "Skipped";
      t.lastError = "No numbers to upload";
      t.lastUploadedAt = new Date();
      await t.save();
      results.push({ target: t.name, status: "Skipped" });
      continue;
    }

    try {
      const res = await ringbaUploadService.uploadAndAssign({
        targetId: t.ringbaTargetId,
        name: bulkTagName,
        numbers: useNumbers,
      });

      t.lastBulkTagId = res.bulkTagId;
      t.lastUploadedCount = res.tagCount || useNumbers.length;
      t.lastUploadedAt = new Date();
      t.lastStatus = "Success";
      t.lastError = null;
      await t.save();

      logger.info(`[fetch] Target "${t.name}" (${t.ringbaTargetId}) updated -> ${res.bulkTagId}`);
      results.push({ target: t.name, status: "Success", bulkTagId: res.bulkTagId });
    } catch (err) {
      const msg = err?.message || String(err);
      t.lastStatus = "Failed";
      t.lastError = msg;
      t.lastUploadedAt = new Date();
      await t.save();
      logger.error(`[fetch] Target "${t.name}" update FAILED: ${msg}`);
      results.push({ target: t.name, status: "Failed", error: msg });
    }
  }
  return results;
}

// ──────────────────────────────────────────────────────────────
// Scheduling
// ──────────────────────────────────────────────────────────────
const scheduleFetchJob = (runTime, timezone) => {
  if (scheduledTask) scheduledTask.stop();

  const { cronExpr, hour, minute } = buildCronExpr(runTime, timezone);
  scheduledTask = cron.schedule(
    cronExpr,
    async () => {
      logger.info("Fetch job started");
      await executeFetch(timezone);
    },
    { timezone, scheduled: true }
  );

  logger.info(
    `Fetch job scheduled daily at ${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")} ${timezone}`
  );
};

const executeFetch = async (timezone) => {
  let job = await Job.findOne().sort({ createdAt: -1 });

  if (!job) {
    const defaultTime = new Date();
    defaultTime.setHours(8, 0, 0, 0);
    job = await jobService.createJob(
      computeNextRunFromSchedule(defaultTime, timezone),
      timezone
    );
  }

  const jobId = job._id;
  await jobService.startJob(jobId);

  try {
    const dateStr = moment.tz(timezone).format("DD MMM");
    const runId = `${moment.tz(timezone).format("YYYY-MM-DD")}-${Date.now()}`;

    logger.info(`[executeFetch] Starting products=[${ACTIVE_PRODUCTS.join(", ")}] runId=${runId}`);

    const perCampaignStats = [];
    let totalFetched = 0;
    let totalAfterDedup = 0;
    let totalAfterDNC = 0;
    let totalSaved = 0;

    for (const productKey of ACTIVE_PRODUCTS) {
      const r = await processProduct(productKey, timezone, runId, dateStr);
      if (!r) continue;

      const fetched = r.sourceStats.reduce((a, s) => a + s.fetched, 0);
      const saved = r.sourceStats.reduce((a, s) => a + s.saved, 0);

      totalFetched += fetched;
      totalAfterDedup += r.unique;
      totalAfterDNC += r.afterDNC;
      totalSaved += saved;

      perCampaignStats.push({
        campaignName: productKey,
        fetchedCount: fetched,
        afterDedup: r.unique,
        afterDNC: r.afterDNC,
        finalSaved: saved,
        sources: r.sourceStats.map((s) => ({
          source: s.source,
          fetched: s.fetched,
          saved: s.saved,
        })),
      });
    }

    const nextRun = computeNextRunFromSchedule(job.runTime, timezone, new Date());
    await Job.findByIdAndUpdate(jobId, { runTime: nextRun });

    await jobService.updateJobStats(jobId, {
      totalFetched,
      totalUniqueAfterDedup: totalAfterDedup,
      totalAfterDNCRemoval: totalAfterDNC,
      totalSaved,
      perCampaignStats,
      runId,
    });

    logger.info(
      `[executeFetch] Completed totalFetched=${totalFetched} afterDedup=${totalAfterDedup} afterDNC=${totalAfterDNC} saved=${totalSaved}`
    );
  } catch (err) {
    logger.error("Fetch job failed:", err);
    await jobService.failJob(jobId, err?.message || "Unknown error");
  }
};

module.exports = { scheduleFetchJob, executeFetch, processProduct };
