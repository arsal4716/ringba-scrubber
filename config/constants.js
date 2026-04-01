"use strict";

const AVAILABLE_CAMPAIGNS = ["FE", "SSDI", "ACA CPL Scrub", "ACA CPL", "Medicare"];

const CAMPAIGN_DB_MAP = {
  FE: "FE",
  SSDI: "SSDI",
  "ACA CPL": "ACAXfers",
  "ACA CPL Scrub": "ACAXfers",
  Medicare: "MedicareXfersCPL",
};

const BUYER_API_CAMPAIGNS = ["ACA CPL Scrub"];

module.exports = { AVAILABLE_CAMPAIGNS, CAMPAIGN_DB_MAP, BUYER_API_CAMPAIGNS };
