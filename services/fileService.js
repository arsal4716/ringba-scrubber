"use strict";

const fs = require("fs");
const path = require("path");

const File = require("../models/File");
const { deduplicateNumbers } = require("../utils/dedupHelper");
const { toStorageFormat } = require("../utils/phoneNormalizer");
const googleSheetsService = require("./googleSheetsService");
const logger = require("../utils/logger");

const GENERATED_DIR = path.join(__dirname, "../uploads/generated");

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
   * Generate .txt files for campaign plans.
   * @param {string} dateStr
   * @param {{campaignName:string, fetchType:'45days'|'1year'|'combined', numbers:string[]}[]} plans
   */
  async generateFiles(dateStr, plans) {
    const docs = [];
    if (!Array.isArray(plans) || plans.length === 0) return docs;

    for (const p of plans) {
      const rawNumbers = p?.numbers || [];

      logger.info(
        `[fileService] Preparing file for ${p.campaignName} (${p.fetchType}) rawCount=${rawNumbers.length}`
      );

      const normalized = rawNumbers
        .map(toStorageFormat)
        .filter(Boolean);

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

      // Sync only the main campaign tabs user requested
      if (["ACA", "FE", "SSDI", "Medicare"].includes(p.campaignName)) {
        try {
          await googleSheetsService.writePhoneNumbers(p.campaignName, unique);
        } catch (err) {
          logger.error(
            `[fileService] Google Sheet sync failed for ${p.campaignName}: ${err.message}`
          );
        }
      }

      docs.push(doc);
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