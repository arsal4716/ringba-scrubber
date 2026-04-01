"use strict";

const cron = require("node-cron");
const moment = require("moment-timezone");

const Job = require("../models/Job");
const Call = require("../models/Call");

const jobService = require("../services/jobService");
const ringbaService = require("../services/ringbaService");
const fileService = require("../services/fileService");

const { filterDNC } = require("../utils/dncFilter");
const { deduplicateNumbers } = require("../utils/dedupHelper");
const { getDateRange } = require("../utils/dateHelpers");
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
 * Normalize phone for DB save + uploaded-file matching.
 * Output is 10-digit US local format.
 */
function normalizePhone(value) {
  if (!value) return "";

  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (digits.length > 10) {
    return digits.slice(-10);
  }

  return digits;
}

async function replaceCallsSnapshot({ campaignName, fetchType, numbers, runId }) {
  const cleaned = (numbers || []).map(normalizePhone).filter(Boolean);
  const attempted = cleaned.length;

  logger.info(
    `[replaceCallsSnapshot] campaign=${campaignName} fetchType=${fetchType} attempted=${attempted}`
  );

  await Call.deleteMany({ campaignName, fetchType });

  if (!cleaned.length) {
    logger.warn(
      `[replaceCallsSnapshot] campaign=${campaignName} fetchType=${fetchType} no numbers after cleanup`
    );
    return { attempted, inserted: 0, deletedOld: "all" };
  }

  const docs = cleaned.map((phoneNumber) => ({
    phoneNumber, // saved as 10-digit normalized
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
    const res = await Call.collection.insertMany(batch, { ordered: false });
    inserted += res?.insertedCount || batch.length;
    logger.info(
      `[replaceCallsSnapshot] campaign=${campaignName} fetchType=${fetchType} batchInserted=${batch.length} runningInserted=${inserted}`
    );
  }

  logger.info(
    `[replaceCallsSnapshot] campaign=${campaignName} fetchType=${fetchType} completed inserted=${inserted}`
  );

  return { attempted, inserted, deletedOld: "all" };
}

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
    job = await jobService.createJob(computeNextRunFromSchedule(defaultTime, timezone), timezone);
  }

  const jobId = job._id;
  await jobService.startJob(jobId);

  try {
    const dateStr = moment.tz(timezone).format("DD MMM");
    const runId = `${moment.tz(timezone).format("YYYY-MM-DD")}-${Date.now()}`;

    const tasks = [
      {
        campaignName: "FE",
        fetchType: "45days",
        mode: "contains",
        ringbaPattern: "FE",
        dateRange: getDateRange(timezone, "45days"),
        callLengthMin: 300,
        chunkDays: 1,
      },
      {
        campaignName: "ACAXfers",
        fetchType: "1year",
        mode: "contains",
        ringbaPattern: "ACA-Xfers",
        dateRange: getDateRange(timezone, "1year"),
        callLengthMin: 600,
        chunkDays: 1,
      },
      {
        campaignName: "ACAXfers",
        fetchType: "45days",
        mode: "contains",
        ringbaPattern: "ACA-Xfers",
        dateRange: getDateRange(timezone, "45days"),
        callLengthMin: 240,
        chunkDays: 1,
        mergeKey: "ACAXfers_combined",
      },

      {
        campaignName: "SSDI",
        fetchType: "45days",
        mode: "contains",
        ringbaPattern: "SSDI",
        dateRange: getDateRange(timezone, "45days"),
        callLengthMin: 300,
        chunkDays: 1,
      },
      {
        campaignName: "SSDI",
        fetchType: "1year",
        mode: "contains",
        ringbaPattern: "SSDI",
        dateRange: getDateRange(timezone, "1year"),
        callLengthMin: null,
        hasPayout: true,
        chunkDays: 1,
      },
      {
        campaignName: "MedicareXfersCPL",
        fetchType: "1year",
        mode: "exactNames",
        exactCampaignNames: ["Medicare-ENG-Xfers-CPL reg", "Medicare-ENG-Xfers-CPL RTB"],
        dateRange: getDateRange(timezone, "1year"),
        callLengthMin: 300,
        chunkDays: 1,
        mergeKey: "MedicareXfersCPL_combined",
      },
    ];

    const results = [];
    let totalFetched = 0;
    let totalAfterDedup = 0;
    let totalAfterDNC = 0;
    let totalSaved = 0;

    logger.info(`[executeFetch] Starting ${tasks.length} fetch tasks runId=${runId}`);

    // 1) FETCH
    for (const t of tasks) {
      logger.info(
        `[executeFetch] Fetching campaign=${t.campaignName} fetchType=${t.fetchType} pattern=${t.ringbaPattern || "exactNames"} callLengthMin=${t.callLengthMin}`
      );

      let fetchedNumbers = [];
      try {
        if (t.mode === "exactNames") {
          const out = await ringbaService.fetchNumbersForExactCampaignNamesChunked(
            t.exactCampaignNames,
            t.dateRange,
            t.callLengthMin,
            { chunkDays: t.chunkDays || 1 }
          );
          fetchedNumbers = out.numbers || [];
          totalFetched += out.fetchedCount || fetchedNumbers.length;
        } else {
          const out = await ringbaService.fetchNumbersForCampaignChunked(
            t.ringbaPattern,
            t.dateRange,
            t.callLengthMin,
            {
              chunkDays: t.chunkDays || 1,
              hasPayout: t.hasPayout === true,
            }
          );
          fetchedNumbers = out.numbers || [];
          totalFetched += out.fetchedCount || fetchedNumbers.length;
        }

        logger.info(
          `[executeFetch] Fetched campaign=${t.campaignName} fetchType=${t.fetchType} rawFetched=${fetchedNumbers.length}`
        );
      } catch (err) {
        logger.error(
          `[executeFetch] Failed campaign=${t.campaignName} fetchType=${t.fetchType}: ${err?.message || err}`
        );
      }

      results.push({
        campaignName: t.campaignName,
        fetchType: t.fetchType,
        mergeKey: t.mergeKey,
        fetchedNumbers,
      });
    }

    const perCampaignStats = [];
    const filePlans = new Map();

    // 2) Normalize + dedup + DNC + save snapshots
    for (const r of results) {
      const fetchedCount = r.fetchedNumbers.length;

      const normalized = r.fetchedNumbers.map(normalizePhone).filter(Boolean);
      const unique = deduplicateNumbers(normalized);
      const afterDNC = await filterDNC(unique);

      logger.info(
        `[executeFetch] campaign=${r.campaignName} fetchType=${r.fetchType} fetched=${fetchedCount} normalized=${normalized.length} unique=${unique.length} afterDNC=${afterDNC.length}`
      );

      const saveRes = await replaceCallsSnapshot({
        campaignName: r.campaignName,
        fetchType: r.fetchType,
        numbers: afterDNC,
        runId,
      });

      totalAfterDedup += unique.length;
      totalAfterDNC += afterDNC.length;
      totalSaved += saveRes.inserted;

      perCampaignStats.push({
        campaignName: `${r.campaignName}${["SSDI", "ACAXfers"].includes(r.campaignName) ? ` (${r.fetchType})` : ""}`,
        fetchedCount,
        afterDedup: unique.length,
        afterDNC: afterDNC.length,
        finalSaved: saveRes.inserted,
      });

      // File planning
      if (r.campaignName === "SSDI") {
        const key = "SSDI_combined";
        if (!filePlans.has(key)) {
          filePlans.set(key, { campaignName: "SSDI", fetchType: "combined", numbers: [] });
        }
        filePlans.get(key).numbers.push(...afterDNC);
      } else if (r.campaignName === "ACAXfers") {
        const key = "ACAXfers_combined";
        if (!filePlans.has(key)) {
          filePlans.set(key, { campaignName: "ACAXfers", fetchType: "combined", numbers: [] });
        }
        filePlans.get(key).numbers.push(...afterDNC);
      } else if (r.mergeKey) {
        const key = r.mergeKey;
        if (!filePlans.has(key)) {
          filePlans.set(key, { campaignName: r.campaignName, fetchType: "combined", numbers: [] });
        }
        filePlans.get(key).numbers.push(...afterDNC);
      } else {
        const key = `${r.campaignName}_${r.fetchType}`;
        filePlans.set(key, {
          campaignName: r.campaignName,
          fetchType: r.fetchType,
          numbers: afterDNC,
        });
      }
    }

    // 3) final dedup again before file generation
    const finalPlans = Array.from(filePlans.values()).map((p) => {
      const finalUnique = deduplicateNumbers((p.numbers || []).map(normalizePhone).filter(Boolean));

      logger.info(
        `[executeFetch] File plan campaign=${p.campaignName} fetchType=${p.fetchType} mergedCount=${(p.numbers || []).length} finalUnique=${finalUnique.length}`
      );

      return {
        ...p,
        numbers: finalUnique,
      };
    });

    // 4) Generate files
    const fileDocs = await fileService.generateFiles(dateStr, finalPlans);

    const acaLines = perCampaignStats.filter((s) => (s.campaignName || "").startsWith("ACAXfers ("));
    if (acaLines.length) {
      perCampaignStats.push({
        campaignName: "ACAXfers (combined)",
        fetchedCount: acaLines.reduce((a, s) => a + (s.fetchedCount || 0), 0),
        afterDedup: acaLines.reduce((a, s) => a + (s.afterDedup || 0), 0),
        afterDNC: acaLines.reduce((a, s) => a + (s.afterDNC || 0), 0),
        finalSaved: acaLines.reduce((a, s) => a + (s.finalSaved || 0), 0),
      });
    }

    const ssdiLines = perCampaignStats.filter((s) => (s.campaignName || "").startsWith("SSDI ("));
    if (ssdiLines.length) {
      perCampaignStats.push({
        campaignName: "SSDI (combined)",
        fetchedCount: ssdiLines.reduce((a, s) => a + (s.fetchedCount || 0), 0),
        afterDedup: ssdiLines.reduce((a, s) => a + (s.afterDedup || 0), 0),
        afterDNC: ssdiLines.reduce((a, s) => a + (s.afterDNC || 0), 0),
        finalSaved: ssdiLines.reduce((a, s) => a + (s.finalSaved || 0), 0),
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
      `[executeFetch] Fetch job completed successfully. fileCount=${fileDocs.length} totalFetched=${totalFetched} totalAfterDedup=${totalAfterDedup} totalAfterDNC=${totalAfterDNC} totalSaved=${totalSaved}`
    );
  } catch (err) {
    logger.error("Fetch job failed:", err);
    await jobService.failJob(jobId, err?.message || "Unknown error");
  }
};

module.exports = { scheduleFetchJob, executeFetch };