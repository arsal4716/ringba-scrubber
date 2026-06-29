"use strict";

const path = require("path");
const fs = require("fs");
const moment = require("moment-timezone");

const ReportJob = require("../models/ReportJob");
const kaliperService = require("./kaliperService");
const idealConceptService = require("./idealConceptService");
const logger = require("../utils/logger");

const REPORTS_DIR = path.join(__dirname, "../uploads/reports");

// Eastern time for ALL report date filtering (Kaliper + IdealConcept).
// America/New_York handles EST/EDT automatically and matches CallGrid's
// reportTimeZone ("US/Eastern"), so every source uses the same boundaries.
const REPORT_TZ = "America/New_York";

// Build the [from, to] ISO window for a YYYY-MM-DD range, using Eastern
// start-of-day → end-of-day.
function windowForRange(startDate, endDate) {
  const dateFrom = moment.tz(startDate, "YYYY-MM-DD", REPORT_TZ).startOf("day").toISOString();
  const dateTo = moment.tz(endDate, "YYYY-MM-DD", REPORT_TZ).endOf("day").toISOString();
  return { dateFrom, dateTo };
}

function buildLabel(type, startDate, endDate) {
  const range = startDate === endDate ? startDate : `${startDate} → ${endDate}`;
  const name =
    type === "kaliper" ? "Kaliper Suppressed CallerIDs"
    : type === "idealconcept" ? "IdealConcept CallerIDs"
    : type;
  return `${name} (${range})`;
}

class ReportService {
  // Create a job and run it in the background. Returns the queued job.
  async createAndRun(type, { startDate, endDate }) {
    if (!startDate || !endDate) throw new Error("startDate and endDate are required");

    const { dateFrom, dateTo } = windowForRange(startDate, endDate);
    const label = buildLabel(type, startDate, endDate);

    const job = await ReportJob.create({
      type,
      label,
      status: "queued",
      percent: 0,
      params: { startDate, endDate, dateFrom, dateTo },
    });

    // Fire and forget — progress is tracked in the DB.
    this._run(job._id.toString()).catch((e) =>
      logger.error(`[report] run ${job._id} crashed: ${e?.message || e}`)
    );

    return job;
  }

  async _run(jobId) {
    const job = await ReportJob.findById(jobId);
    if (!job) return;

    await ReportJob.findByIdAndUpdate(jobId, { status: "processing", startedAt: new Date() });

    // Throttle DB writes so frequent progress callbacks stay cheap.
    let lastPersist = 0;
    const onProgress = (percent, message, fetched = 0) => {
      const now = Date.now();
      if (now - lastPersist < 1000) return;
      lastPersist = now;
      ReportJob.findByIdAndUpdate(jobId, {
        percent: Math.min(99, Math.max(0, Math.round(percent))),
        phase: message,
        fetched,
      }).catch(() => {});
    };

    try {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });

      let buffer;
      let summary = {};
      let baseName;

      if (job.type === "kaliper") {
        const res = await kaliperService.runKaliperReport({ ...job.params, onProgress });
        buffer = res.buffer;
        summary = res.summary || {};
        baseName = `Kaliper_Suppressed_CallerIDs_${job.params.startDate}_to_${job.params.endDate}.xlsx`;
      } else if (job.type === "idealconcept") {
        const res = await idealConceptService.runIdealConceptReport({ ...job.params, onProgress });
        buffer = res.buffer;
        summary = res.summary || {};
        baseName = `IdealConcept_CallerIDs_${job.params.startDate}_to_${job.params.endDate}.xlsx`;
      } else {
        throw new Error(`Unknown report type: ${job.type}`);
      }

      const fileName = baseName.replace(/[^\w.-]/g, "_");
      const filePath = path.join(REPORTS_DIR, `${jobId}__${fileName}`);
      fs.writeFileSync(filePath, buffer);

      await ReportJob.findByIdAndUpdate(jobId, {
        status: "completed",
        percent: 100,
        phase: "Completed",
        fileName,
        filePath,
        summary,
        recordCount: summary.recordCount || 0,
        completedAt: new Date(),
      });
      logger.info(`[report] ${jobId} (${job.type}) completed records=${summary.recordCount || 0}`);
    } catch (err) {
      logger.error(`[report] ${jobId} failed: ${err?.message || err}`);
      await ReportJob.findByIdAndUpdate(jobId, {
        status: "failed",
        error: err?.message || String(err),
        completedAt: new Date(),
      }).catch(() => {});
    }
  }
}

module.exports = new ReportService();
