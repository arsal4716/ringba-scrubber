"use strict";

const fs = require("fs");
const path = require("path");

const File = require("../models/File");
const { deduplicateNumbers } = require("../utils/dedupHelper");
const { toStorageFormat } = require("../utils/phoneNormalizer");
const googleSheetsService = require("./googleSheetsService");
const logger = require("../utils/logger");

const GENERATED_DIR = path.join(__dirname, "../uploads/generated");

// Campaigns that sync to Google Sheets — value is the tab name to write to.
// Campaigns NOT in this map (DonateAKar, AutoInsuranceXfers) get txt files only.
const SHEET_SYNC_MAP = {
  "ACA":             "Database",
  "ACAXfers":        "Database",
  "AssuredHealthACA":"Database",
  "ACA CPL":         "Database",
  "ACA CPL Scrub":   "Database",
  "FE":              "FE",
  "SSDI":            "SSDI",
  "Medicare":        "Medicare",
};

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function sanitizeFileName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

async function writeNumbersTxt(fileName, numbers) {
  await ensureDir(GENERATED_DIR);
  const fullPath = path.join(GENERATED_DIR, fileName);

  const content = numbers.map(String).join("\n") + "\n";

  const tmpPath = `${fullPath}.tmp-${Date.now()}`;
  await fs.promises.writeFile(tmpPath, content, "utf8");
  await fs.promises.rename(tmpPath, fullPath);

  return fullPath;
}

class FileService {
  /**
   * Generate .txt files for campaign plans, then sync to Google Sheets.
   *
   * Sheets are written ONCE PER TAB at the end of the run — all campaigns that
   * share the same tab (e.g. ACAXfers + AssuredHealthACA → Database) have their
   * numbers merged and deduped before a single clear+write. This prevents a
   * second campaign's write from wiping the first campaign's data.
   *
   * @param {string} dateStr
   * @param {{campaignName:string, fetchType:string, numbers:string[]}[]} plans
   */
  /**
   * Generate a single suppression .txt for a product's final number
   * list. Does NOT touch Google Sheets — the daily cron syncs sheets
   * itself (so it can control tab + ordering). Returns the File doc
   * (with filePath) or null when there are no numbers.
   *
   * @param {string} dateStr   e.g. "25 Jun"
   * @param {string} product   e.g. "ACA" | "SSDI"
   * @param {string[]} numbers final, deduped numbers
   */
  async generateProductFile(dateStr, product, numbers, sourceLabel, nameBase, runId) {
    const normalized = (numbers || []).map(toStorageFormat).filter(Boolean);
    const unique = deduplicateNumbers(normalized);

    if (!unique.length) {
      logger.warn(`[fileService] No numbers for product=${product}; skipping file`);
      return null;
    }

    // nameBase lets a special target use its own name instead of the product.
    // e.g. "26 Jun – ACA (QC 6mo Sales + Ringba 30d paid).txt"
    //      "26 Jun – ProHealthPartners-ACA-Xfers-CPL (Ringba 6mo -180s).txt"
    const base = nameBase || product;
    const detail = sourceLabel ? ` (${sourceLabel})` : "";
    const rawName = `${dateStr} – ${base}${detail}.txt`;
    const fileName = sanitizeFileName(rawName);
    const filePath = await writeNumbersTxt(fileName, unique);

    const doc = await File.create({
      fileName,
      filePath,
      campaignName: product,
      fetchType: "combined",
      totalNumbers: unique.length,
      runId: runId || null,
      createdAt: new Date(),
    });

    logger.info(
      `[fileService] Generated product file: ${fileName} totalNumbers=${unique.length}`
    );

    return doc;
  }

  async generateFiles(dateStr, plans) {
    const docs = [];
    if (!Array.isArray(plans) || plans.length === 0) return docs;

    // Accumulate numbers per sheet tab across all plans.
    // Key = tab name (e.g. "Database"), value = combined raw numbers array.
    const tabNumbers = new Map();

    // ── Step 1: generate txt files ───────────────────────────────────────────
    for (const p of plans) {
      const rawNumbers = p?.numbers || [];

      logger.info(
        `[fileService] Preparing file for ${p.campaignName} (${p.fetchType}) rawCount=${rawNumbers.length}`
      );

      const normalized = rawNumbers.map(toStorageFormat).filter(Boolean);
      const unique = deduplicateNumbers(normalized);

      logger.info(
        `[fileService] ${p.campaignName} (${p.fetchType}) normalizedCount=${normalized.length} uniqueCount=${unique.length}`
      );

      if (!unique.length) {
        logger.warn(
          `[fileService] Skipping file for ${p.campaignName} (${p.fetchType}) because no numbers remained after normalization/dedup`
        );
        continue;
      }

      const rawName = this._generateFileName(dateStr, p.campaignName, p.fetchType);
      const fileName = sanitizeFileName(rawName);
      const filePath = await writeNumbersTxt(fileName, unique);

      const doc = await File.create({
        fileName,
        filePath,
        campaignName: p.campaignName,
        fetchType: p.fetchType,
        totalNumbers: unique.length,
        createdAt: new Date(),
      });

      logger.info(
        `[fileService] Generated file: ${fileName} totalNumbers=${unique.length} path=${filePath}`
      );

      docs.push(doc);

      // Accumulate into the correct sheet tab (if this campaign syncs to sheets)
      const tabName = SHEET_SYNC_MAP[p.campaignName];
      if (tabName) {
        if (!tabNumbers.has(tabName)) tabNumbers.set(tabName, []);
        tabNumbers.get(tabName).push(...unique);
      }
    }

    // ── Step 2: write each tab ONCE with all combined numbers ─────────────────
    // This means ACAXfers + AssuredHealthACA are merged into one clear+write on
    // the Database tab — no second campaign can wipe the first's data.
    for (const [tabName, numbers] of tabNumbers) {
      const finalUnique = deduplicateNumbers(
        numbers.map(toStorageFormat).filter(Boolean)
      );

      logger.info(
        `[fileService] Syncing tab=${tabName} combinedCount=${numbers.length} finalUnique=${finalUnique.length}`
      );

      try {
        await googleSheetsService.writePhoneNumbersToTab(tabName, finalUnique);
      } catch (err) {
        logger.error(
          `[fileService] Google Sheet sync failed for tab=${tabName}: ${err.message}`
        );
      }
    }

    return docs;
  }

  _generateFileName(dateStr, campaign, type) {
    if (campaign === "FE") return `${dateStr} – last 45 days FE calls.txt`;
    if (campaign === "ACAXfers") return `${dateStr} – ACA-Xfers calls (1y + 45d > 240s).txt`;
    if (campaign === "SSDI") return `${dateStr} – SSDI calls (45d + 1y).txt`;
    if (campaign === "MedicareXfersCPL") {
      return `${dateStr} – last 1 year Medicare-Xfers-CPL (reg + RTB).txt`;
    }
    if (campaign === "AssuredHealthACA") {
      return `${dateStr} – Assured Health ACA-Xfers-CPL (hasConnected, 30d).txt`;
    }
    if (campaign === "DonateAKar") {
      return `${dateStr} – Donate a Kar calls (90d > 60s).txt`;
    }
    if (campaign === "AutoInsuranceXfers") {
      return `${dateStr} – Auto Insurance Xfers-RevShare (6mo > 3min).txt`;
    }

    const label =
      type === "45days" ? "last 45 days" : type === "1year" ? "last 1 year" : "combined";

    return `${dateStr} – ${campaign} calls (${label}).txt`;
  }

  async deleteOldFiles(days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(days || 7));

    const oldFiles = await File.find({ createdAt: { $lt: cutoff } }).lean();

    for (const file of oldFiles) {
      const filePath = file.filePath ? file.filePath : path.join(GENERATED_DIR, file.fileName);

      try {
        await fs.promises.unlink(filePath);
      } catch (err) {
        if (err?.code !== "ENOENT") {
          logger.error(`Error deleting file ${file.fileName}: ${err.message}`);
        }
      }

      await File.deleteOne({ _id: file._id });
      logger.info(`Deleted old file record: ${file.fileName}`);
    }
  }
}

module.exports = new FileService();