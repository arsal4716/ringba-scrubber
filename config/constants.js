"use strict";

const AVAILABLE_CAMPAIGNS = ["FE", "SSDI", "ACA CPL Scrub", "ACA CPL", "Medicare"];

/**
 * Maps publisher-facing campaign name to internal Call DB campaignName
 */
const CAMPAIGN_DB_MAP = {
  FE: "FE",
  SSDI: "SSDI",
  "ACA CPL": "ACAXfers",
  "ACA CPL Scrub": "ACAXfers",
  Medicare: "MedicareXfersCPL",
};

/**
 * Campaigns that require buyer API check in addition to DB check
 */
const BUYER_API_CAMPAIGNS = ["ACA CPL Scrub"];

module.exports = { AVAILABLE_CAMPAIGNS, CAMPAIGN_DB_MAP, BUYER_API_CAMPAIGNS };
