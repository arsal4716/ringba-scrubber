"use strict";

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const logger = require("../utils/logger");
const { toStorageFormat } = require("../utils/phoneNormalizer");

const SPREADSHEET_ID = "10wDKwHfS5ytpOxSPIr89PG0J1hRoKQ7S_3Qvjk-Pqlk";
const SHEET_CONFIG_PATH =
  process.env.GOOGLE_SHETS_CREDENTIALS ||
  path.join(__dirname, "../config/sheet.json");
const TAB_MAP = {
  "ACA CPL Scrub": "Database",
  "ACA CPL": "Database",
  FE: "FE",
  SSDI: "SSDI",
  Medicare: "Medicare",
};

class GoogleSheetsService {
  constructor() {
    this.sheets = null;
  }

  async getClient() {
    if (this.sheets) return this.sheets;

    const raw = await fs.promises.readFile(SHEET_CONFIG_PATH, "utf8");
    const creds = JSON.parse(raw);

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const authClient = await auth.getClient();
    this.sheets = google.sheets({ version: "v4", auth: authClient });
    return this.sheets;
  }

  getTabName(campaignName) {
    return TAB_MAP[campaignName] || null;
  }

  async ensureHeader(tabName) {
    const sheets = await this.getClient();

    const headerRange = `'${tabName}'!A1:A1`;
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: headerRange,
    });

    const current = existing?.data?.values?.[0]?.[0] || "";
    if (current === "phoneNumber") return;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: headerRange,
      valueInputOption: "RAW",
      requestBody: {
        values: [["phoneNumber"]],
      },
    });
  }

  async clearTabDataKeepHeader(tabName) {
    const sheets = await this.getClient();

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A2:A`,
    });
  }

  async writePhoneNumbers(campaignName, numbers) {
    const tabName = this.getTabName(campaignName);
    if (!tabName) {
      logger.warn(`[googleSheetsService] No tab mapping for campaign=${campaignName}`);
      return;
    }

    const cleaned = [...new Set(
      (Array.isArray(numbers) ? numbers : [])
        .map(toStorageFormat)
        .filter(Boolean)
    )];

    const sheets = await this.getClient();

    await this.ensureHeader(tabName);
    await this.clearTabDataKeepHeader(tabName);

    if (!cleaned.length) {
      logger.warn(`[googleSheetsService] No valid numbers to write for ${campaignName}`);
      return;
    }

    const CHUNK_SIZE = 5000;

    for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
      const chunk = cleaned.slice(i, i + CHUNK_SIZE);
      const startRow = i + 2;
      const endRow = startRow + chunk.length - 1;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A${startRow}:A${endRow}`,
        valueInputOption: "RAW",
        requestBody: {
          values: chunk.map((n) => [n]),
        },
      });

      logger.info(
        `[googleSheetsService] Wrote ${chunk.length} rows to ${tabName} (${startRow}-${endRow})`
      );
    }

    logger.info(
      `[googleSheetsService] Sync complete for campaign=${campaignName}, total=${cleaned.length}, tab=${tabName}`
    );
  }
}

module.exports = new GoogleSheetsService();