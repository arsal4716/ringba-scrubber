"use strict";

// ─────────────────────────────────────────────────────────────
// Publisher / scrub portal config (preserved — used by the
// publisher upload + scrub features, NOT by the daily fetch).
// ─────────────────────────────────────────────────────────────
// Campaigns a publisher can scrub against. Trimmed to the two active
// products; each maps to the campaignName stored in the Call DB.
const AVAILABLE_CAMPAIGNS = ["ACA", "SSDI"];

const CAMPAIGN_DB_MAP = {
  ACA: "ACA",
  SSDI: "SSDI",
  // ── Legacy labels (kept so older publisher records still resolve) ──
  FE: "FE",
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
        days: 30, // last 30 days
        paid: true, // CallPaid = true
        // CallGrid-internal campaign ids for ACA (from the report filter).
        campaignIds: [
          "cmqjw9gez05ca07l8woq8j8xr", // ACA-Xfers-CPA
          "cmovrt5za033t07jso1cdpvk4", // ACA-Xfers-CPL
          "cmqsca8by03h806jy18w1flkd", // ACA-Xfers-CPL-RTB
        ],
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

// ─────────────────────────────────────────────────────────────
// Special per-target overrides.
//
// Most targets for a product receive the normal combined suppression
// file. A target listed here instead gets its OWN file built from a
// dedicated Ringba query (e.g. long calls only), and only that target
// is pointed at it — every other target keeps the standard file.
//
// Keyed by Ringba target id.
// ─────────────────────────────────────────────────────────────
const SPECIAL_TARGETS = {
  // ProHealthPartners-ACA-Xfers-CPL — last 6 months, calls longer
  // than 180s (campaignName CONTAINS "ACA").
  PIca34d71965774f93907e1dcbd17ac221: {
    label: "ProHealthPartners-ACA-Xfers-CPL",
    product: "ACA",
    source: "ringba",
    search: "ACA",
    months: 6,
    callLengthMinSeconds: 180,
    paid: false,
  },
};

module.exports = {
  AVAILABLE_CAMPAIGNS,
  CAMPAIGN_DB_MAP,
  BUYER_API_CAMPAIGNS,
  PRODUCTS,
  ACTIVE_PRODUCTS,
  SPECIAL_TARGETS,
};
