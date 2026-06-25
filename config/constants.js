"use strict";

// ─────────────────────────────────────────────────────────────
// Publisher / scrub portal config (preserved — used by the
// publisher upload + scrub features, NOT by the daily fetch).
// ─────────────────────────────────────────────────────────────
const AVAILABLE_CAMPAIGNS = ["FE", "SSDI", "ACA CPL Scrub", "ACA CPL", "Medicare"];

const CAMPAIGN_DB_MAP = {
  FE: "FE",
  SSDI: "SSDI",
  "ACA CPL": "ACA",
  "ACA CPL Scrub": "ACA",
  Medicare: "MedicareXfersCPL",
};

const BUYER_API_CAMPAIGNS = ["ACA CPL Scrub"];

// ─────────────────────────────────────────────────────────────
// Daily automation products.
//
// Each product describes WHERE its numbers come from and WHERE
// they go (Google Sheet tab). The Ringba ping-tree targets that
// receive the generated suppression file are managed separately
// in the Targets admin page (see models/Target.js) and matched
// to a product by the `product` field.
//
// Sources:
//   ringba   – Ringba call-log report (campaignName CONTAINS + paid + N days)
//   qc       – QC tools (callcheckai.com) CSV export
//   callgrid – CallGrid /call API (requires CALLGRID_* env, see .env.example)
// ─────────────────────────────────────────────────────────────
const PRODUCTS = {
  ACA: {
    key: "ACA",
    label: "ACA",
    sheetTab: "Database", // ACA numbers go in the "Database" tab
    sources: {
      ringba: {
        enabled: true,
        search: "ACA", // campaignName CONTAINS "ACA"
        days: 30, // last 30 days
        paid: true, // paid calls only (hasPayout = yes)
      },
      qc: {
        enabled: true,
        datePreset: "last_6_months", // last 6 months
        disposition: "Sales", // sales calls
        search: "ACA", // campaignName CONTAINS "ACA"
      },
      callgrid: {
        enabled: true, // CallGrid /call API (requires CALLGRID_* env)
        search: "ACA",
        days: 30,
        paid: true,
      },
    },
  },

  SSDI: {
    key: "SSDI",
    label: "SSDI",
    sheetTab: "SSDI", // SSDI numbers go in the "SSDI" tab
    sources: {
      ringba: { enabled: false },
      qc: {
        enabled: true,
        datePreset: "last_6_months", // last 6 months
        disposition: "Sales", // paid / sales calls only
        search: "SSDI", // campaignName CONTAINS "SSDI"
        paidOnly: true,
      },
      callgrid: { enabled: false },
    },
  },
};

// Products the daily cron processes, in order.
const ACTIVE_PRODUCTS = ["ACA", "SSDI"];

module.exports = {
  AVAILABLE_CAMPAIGNS,
  CAMPAIGN_DB_MAP,
  BUYER_API_CAMPAIGNS,
  PRODUCTS,
  ACTIVE_PRODUCTS,
};
