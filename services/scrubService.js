"use strict";

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const XLSX = require("xlsx");

const DNC = require("../models/DNC");
const Call = require("../models/Call");
const ScrubJob = require("../models/ScrubJob");
const buyerApiService = require("./buyerApiService");
const logger = require("../utils/logger");
const { normalizePhone, toDNCFormat } = require("../utils/phoneNormalizer");
const { CAMPAIGN_DB_MAP, BUYER_API_CAMPAIGNS } = require("../config/constants");

const OUTPUT_DIR = path.join(__dirname, "../uploads/scrub-output");

// ─── Phone column name detection ─────────────────────────────
const PHONE_COLUMN_ALIASES = [
  "phonenumber",
  "phone",
  "phonenumber",
  "number",
  "callerid",
  "callerid",
  "phone number",
];

function detectPhoneColumn(headers) {
  const normalized = headers.map((h) => ({
    original: h,
    key: String(h).toLowerCase().replace(/\s+/g, ""),
  }));
  for (const alias of PHONE_COLUMN_ALIASES) {
    const cleaned = alias.replace(/\s+/g, "");
    const found = normalized.find((h) => h.key === cleaned);
    if (found) return found.original;
  }
  return null;
}

// ─── Batch DB lookups ─────────────────────────────────────────

async function checkDNCBatch(numbers10) {
  if (!numbers10.length) return new Set();

  const uniqueNumbers = [...new Set(numbers10)];
  const dncFormatted = uniqueNumbers.map(toDNCFormat);

  const found = await DNC.find({
    phoneNumber: { $in: dncFormatted },
  })
    .distinct("phoneNumber")
    .lean();

  return new Set(
    found
      .map((n) => normalizePhone(n))
      .filter((x) => x.valid)
      .map((x) => x.normalized)
  );
}
async function checkCampaignBatch(numbers10, dbCampaignName) {
  if (!numbers10.length) return new Set();

  const uniqueNumbers = [...new Set(numbers10)];
  const numbersE164 = uniqueNumbers.map((n) => `+1${n}`);

  const found = await Call.find({
    campaignName: dbCampaignName,
    phoneNumber: { $in: [...uniqueNumbers, ...numbersE164] },
  })
    .distinct("phoneNumber")
    .lean();

  return new Set(
    found
      .map((n) => normalizePhone(n))
      .filter((x) => x.valid)
      .map((x) => x.normalized)
  );
}
// ─── CSV helpers ─────────────────────────────────────────────

function escapeCSV(val) {
  const s = val !== undefined && val !== null ? String(val) : "";
  // Always quote to handle commas and newlines in values
  return `"${s.replace(/"/g, '""')}"`;
}

function rowToCSVLine(headers, row) {
  return headers.map((h) => escapeCSV(row[h] !== undefined ? row[h] : "")).join(",");
}

// ─── Main Scrub Service class ─────────────────────────────────

class ScrubService {
  constructor() {
    this.io = null;
  }

  /** Called from server.js after Socket.IO server is created */
  setIO(io) {
    this.io = io;
  }

  /** Emit progress event to all sockets in this job's room */
  emitProgress(jobId, data) {
    if (this.io) {
      this.io.to(`job:${jobId}`).emit("scrub:progress", data);
    }
  }

  /**
   * Public entry point – called after job is created in DB.
   * Runs asynchronously; updates DB and emits Socket.IO events.
   */
  async processJob(jobId) {
    const job = await ScrubJob.findById(jobId);
    if (!job) throw new Error(`ScrubJob ${jobId} not found`);

    await ScrubJob.findByIdAndUpdate(jobId, {
      status: "processing",
      startedAt: new Date(),
    });

    try {
      const { stats, outputFileName } = await this._process(job);

      await ScrubJob.findByIdAndUpdate(jobId, {
        status: "completed",
        completedAt: new Date(),
        downloadFilePath: outputFileName,
        totalRows: stats.totalRows,
        processedRows: stats.processedRows,
        duplicateCount: stats.duplicateCount,
        dncCount: stats.dncCount,
        invalidCount: stats.invalidCount,
        nonDuplicateCount: stats.nonDuplicateCount,
      });

      this.emitProgress(jobId, {
        event: "completed",
        ...stats,
        downloadFilePath: outputFileName,
        completionPercent: 100,
      });

      logger.info(`ScrubJob ${jobId} completed. Stats: ${JSON.stringify(stats)}`);
    } catch (err) {
      logger.error(`ScrubJob ${jobId} failed: ${err.message}`);

      await ScrubJob.findByIdAndUpdate(jobId, {
        status: "failed",
        errorMessage: err.message,
      });

      this.emitProgress(jobId, { event: "failed", error: err.message });
    }
  }

  // ─── Internal processing orchestrator ──────────────────────

  async _process(job) {
    const { _id: jobId, storedFilePath, campaign, originalFileName } = job;
    const ext = path.extname(originalFileName).toLowerCase();
    const dbCampaign = CAMPAIGN_DB_MAP[campaign];
    const usesBuyerAPI = BUYER_API_CAMPAIGNS.includes(campaign);

    if (!dbCampaign) {
      throw new Error(`Unknown campaign: ${campaign}`);
    }

    await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

    const safeBase = path
      .basename(originalFileName, ext)
      .replace(/[^\w\-. ]/g, "_")
      .slice(0, 60);
    const outputFileName = `scrubbed_${Date.now()}_${safeBase}.csv`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);

    const stats = {
      totalRows: 0,
      processedRows: 0,
      duplicateCount: 0,
      dncCount: 0,
      invalidCount: 0,
      nonDuplicateCount: 0,
    };

    if (ext === ".csv") {
      await this._processCSV(
        storedFilePath,
        outputPath,
        campaign,
        dbCampaign,
        usesBuyerAPI,
        jobId.toString(),
        stats
      );
    } else {
      // .xlsx or .xls
      await this._processXLSX(
        storedFilePath,
        outputPath,
        campaign,
        dbCampaign,
        usesBuyerAPI,
        jobId.toString(),
        stats
      );
    }

    return { stats, outputFileName };
  }

  // ─── CSV Processing (streaming) ─────────────────────────────

  async _processCSV(inputPath, outputPath, campaign, dbCampaign, usesBuyerAPI, jobId, stats) {
    // Pass 1: count rows and collect all data
    const rows = [];
    let headers = null;
    let phoneCol = null;

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(inputPath).pipe(csv());

      stream.on("headers", (hdrs) => {
        headers = hdrs;
        phoneCol = detectPhoneColumn(hdrs);
        if (!phoneCol) {
          logger.error(
            `No phone column detected in headers: ${hdrs.join(", ")}`
          );
        }
      });

      stream.on("data", (row) => rows.push(row));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    stats.totalRows = rows.length;

    this.emitProgress(jobId, {
      event: "started",
      totalRows: stats.totalRows,
      campaign,
      phoneColumnDetected: phoneCol || "NONE",
    });

    await this._processRowsAndWrite(
      rows,
      headers || [],
      phoneCol,
      outputPath,
      dbCampaign,
      usesBuyerAPI,
      jobId,
      stats
    );
  }

  // ─── XLSX/XLS Processing ─────────────────────────────────────

  async _processXLSX(inputPath, outputPath, campaign, dbCampaign, usesBuyerAPI, jobId, stats) {
    const workbook = XLSX.readFile(inputPath, { cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const phoneCol = detectPhoneColumn(headers);

    stats.totalRows = rows.length;

    this.emitProgress(jobId, {
      event: "started",
      totalRows: stats.totalRows,
      campaign,
      phoneColumnDetected: phoneCol || "NONE",
    });

    await this._processRowsAndWrite(
      rows,
      headers,
      phoneCol,
      outputPath,
      dbCampaign,
      usesBuyerAPI,
      jobId,
      stats
    );
  }

  // ─── Row processing + CSV writing ────────────────────────────

  async _processRowsAndWrite(
    rows,
    headers,
    phoneCol,
    outputPath,
    dbCampaign,
    usesBuyerAPI,
    jobId,
    stats
  ) {
    const BATCH_SIZE = 500;
    const PROGRESS_EMIT_EVERY = 1000; // rows
    const outputHeaders = [...(headers || []), "scrub_status"];

    const writeStream = fs.createWriteStream(outputPath, { encoding: "utf8" });

    // Write CSV header
    writeStream.write(outputHeaders.map(escapeCSV).join(",") + "\n");

    let lastEmit = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const processed = await this._processBatch(
        batch,
        phoneCol,
        dbCampaign,
        usesBuyerAPI,
        stats
      );

      for (const row of processed) {
        writeStream.write(rowToCSVLine(outputHeaders, row) + "\n");
      }

      stats.processedRows = Math.min(i + BATCH_SIZE, rows.length);

      // Throttle Socket.IO emissions
      if (
        stats.processedRows - lastEmit >= PROGRESS_EMIT_EVERY ||
        stats.processedRows === stats.totalRows
      ) {
        lastEmit = stats.processedRows;
        this.emitProgress(jobId, {
          event: "progress",
          ...stats,
          completionPercent:
            stats.totalRows > 0
              ? Math.round((stats.processedRows / stats.totalRows) * 100)
              : 0,
        });
      }
    }

    await new Promise((resolve, reject) => {
      writeStream.end((err) => (err ? reject(err) : resolve()));
    });
  }

  // ─── Single batch processor ───────────────────────────────

async _processBatch(rows, phoneCol, dbCampaign, usesBuyerAPI, stats) {
  const t0 = Date.now();

  const entries = rows.map((row) => {
    const raw = phoneCol ? row[phoneCol] || "" : "";
    const { original, normalized, valid } = normalizePhone(raw);
    return { row, original, normalized, valid };
  });

  const t1 = Date.now();

  const validEntries = entries.filter((e) => e.valid);
  const validNumbers = [...new Set(validEntries.map((e) => e.normalized))];

  const dncSet = await checkDNCBatch(validNumbers);
  const t2 = Date.now();

  const nonDNCEntries = validEntries.filter((e) => !dncSet.has(e.normalized));
  const nonDNCNumbers = [...new Set(nonDNCEntries.map((e) => e.normalized))];

  const dupSet = await checkCampaignBatch(nonDNCNumbers, dbCampaign);
  const t3 = Date.now();

  let buyerDupSet = new Set();
  let needsAPICheck = [];

  if (usesBuyerAPI) {
    needsAPICheck = [
      ...new Set(
        nonDNCEntries
          .filter((e) => !dupSet.has(e.normalized))
          .map((e) => e.normalized)
      ),
    ];

    if (needsAPICheck.length > 0) {
      buyerDupSet = await buyerApiService.checkBatch(needsAPICheck);
    }
  }

  const t4 = Date.now();

  return entries.map((entry) => {
    let scrub_status;

    if (!entry.valid) {
      scrub_status = "Invalid Number";
      stats.invalidCount++;
    } else if (dncSet.has(entry.normalized)) {
      scrub_status = "DNC";
      stats.dncCount++;
    } else if (dupSet.has(entry.normalized) || buyerDupSet.has(entry.normalized)) {
      scrub_status = "Duplicate";
      stats.duplicateCount++;
    } else {
      scrub_status = "Not Duplicate";
      stats.nonDuplicateCount++;
    }

    return { ...entry.row, scrub_status };
  });
}
}

module.exports = new ScrubService();
