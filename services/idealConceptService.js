"use strict";

/**
 * IdealConcept report: grab all UNIQUE caller IDs from Ringba and CallGrid
 * for the "IdealConcept" target/destination, over a date range.
 *
 * Ringba: caller IDs where targetName CONTAINS the search term.
 * CallGrid: calls in range, filtered by campaign ids (if configured) or by
 *           destination/source/campaign name containing the term.
 *
 * Config (env):
 *   IDEALCONCEPT_RINGBA_SEARCH          default "IdealConcept"
 *   IDEALCONCEPT_NAME_CONTAINS          default "IdealConcept"
 *   IDEALCONCEPT_CALLGRID_CAMPAIGN_IDS  optional comma-separated ids
 */

const XLSX = require("xlsx");
const ringbaService = require("./ringbaService");
const callGridService = require("./callGridService");
const salesradixService = require("./salesradixService");
const { toNational10 } = require("../utils/phoneNormalizer");
const logger = require("../utils/logger");

const RINGBA_SEARCH = process.env.IDEALCONCEPT_RINGBA_SEARCH || "IdealConcept";
const NAME_CONTAINS = (process.env.IDEALCONCEPT_NAME_CONTAINS || "IdealConcept").toLowerCase();
const CG_CAMPAIGN_IDS = (process.env.IDEALCONCEPT_CALLGRID_CAMPAIGN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Keep only "Rejected - Duplicate" numbers (default). Determined by
// re-querying each caller ID against the SalesRadix availability API and
// keeping results that contain "Duplicate". Set IDEALCONCEPT_DUPLICATE_ONLY
// =false to skip the API check and grab all unique caller IDs.
const DUPLICATE_ONLY = (process.env.IDEALCONCEPT_DUPLICATE_ONLY || "true") !== "false";

function fmtPhone(national10) {
  const d = String(national10 || "");
  if (d.length === 10) return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return national10 || "";
}

function nameMatches(row) {
  const hay = `${row.destinationName} ${row.sourceName} ${row.campaignName}`.toLowerCase();
  return hay.includes(NAME_CONTAINS);
}

async function runIdealConceptReport({ dateFrom, dateTo, startDate, endDate, onProgress } = {}) {
  if (!dateFrom || !dateTo) throw new Error("date range is required");
  const report = (p, m, f) => {
    if (typeof onProgress === "function") onProgress(p, m, f);
  };

  // ── Ringba (≈2–28%) — ALL caller IDs where targetName CONTAINS term ──
  report(2, "Fetching Ringba…", 0);
  const ringbaRecords = await ringbaService.fetchCallLogsByTargetName(
    RINGBA_SEARCH,
    { startDate: new Date(dateFrom), endDate: new Date(dateTo) },
    {
      chunkDays: 7,
      comparisonType: "CONTAINS",
      onChunk: (i, total, fetched) =>
        report(Math.round((i / total) * 26), `Ringba ${i}/${total} chunks`, fetched),
    }
  );
  const ringbaSet = new Set(ringbaRecords.map((r) => toNational10(r.number)).filter(Boolean));
  logger.info(`[idealConcept] Ringba records=${ringbaRecords.length} unique=${ringbaSet.size}`);

  // ── CallGrid (≈30–44%) — ALL caller IDs in scope (by campaign id or name) ──
  report(30, "Fetching CallGrid…", ringbaSet.size);
  const cgRows = await callGridService.fetchCallsForReport({
    startDate,
    endDate,
    campaignIds: CG_CAMPAIGN_IDS,
    onPage: (page, fetched) =>
      report(Math.min(44, 30 + page * 2), `CallGrid page ${page}`, ringbaSet.size + fetched),
  });
  const cgScoped = CG_CAMPAIGN_IDS.length ? cgRows : cgRows.filter(nameMatches);
  const cgSet = new Set(cgScoped.map((r) => toNational10(r.number)).filter(Boolean));
  logger.info(`[idealConcept] CallGrid rows=${cgRows.length} scoped=${cgScoped.length} unique=${cgSet.size}`);

  // ── Union of all unique caller IDs ──
  const union = new Set([...ringbaSet, ...cgSet]);
  const uniqueList = [...union];
  const sourceOf = (n) => {
    const r = ringbaSet.has(n), c = cgSet.has(n);
    return r && c ? "Ringba + CallGrid" : r ? "Ringba" : "CallGrid";
  };

  // ── SalesRadix availability check (≈45–95%) — keep "Rejected - Duplicate" ──
  let dupSet = new Set();
  let apiResults = new Map();
  if (DUPLICATE_ONLY) {
    report(45, `Checking ${uniqueList.length} numbers via SalesRadix…`, uniqueList.length);
    const res = await salesradixService.checkBatch(uniqueList, {
      onProgress: (done, total) =>
        report(45 + Math.round((done / total) * 50), `SalesRadix ${done}/${total}`, done),
    });
    dupSet = res.dupSet;
    apiResults = res.results;
  }

  const kept = DUPLICATE_ONLY ? uniqueList.filter((n) => dupSet.has(n)) : uniqueList;

  // ── Build workbook (≈95%) ──
  report(95, "Building workbook…", kept.length);
  const wb = XLSX.utils.book_new();

  // Sheet 1 — the deliverable: kept (duplicate) caller IDs.
  const keptSorted = [...kept].sort();
  const allAoa = [
    ["Caller ID", "Raw (10-digit)", "Source", "SalesRadix result"],
    ...keptSorted.map((n) => [fmtPhone(n), n, sourceOf(n), apiResults.get(n) || ""]),
  ];
  const wsAll = XLSX.utils.aoa_to_sheet(allAoa);
  wsAll["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsAll, "Duplicate CallerIDs");

  // Sheet 2 — Detail: EVERY unique caller ID with its SalesRadix result and
  // whether it was kept, so the filter can be verified number-by-number.
  const DETAIL_CAP = 20000;
  const detailSorted = [...uniqueList].sort();
  const detailRows = detailSorted.slice(0, DETAIL_CAP);
  const detailAoa = [
    ["Caller ID", "Source", "SalesRadix result", "Kept (duplicate)?"],
    ...detailRows.map((n) => [n, sourceOf(n), DUPLICATE_ONLY ? apiResults.get(n) || "" : "(filter off)", dupSet.has(n) ? "YES" : "no"]),
  ];
  const wsDetail = XLSX.utils.aoa_to_sheet(detailAoa);
  wsDetail["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsDetail, "Detail (filter check)");

  // Sheet 3 — Summary.
  const summaryAoa = [
    ["Metric", "Value"],
    ["Date range (Eastern)", startDate === endDate ? startDate : `${startDate} → ${endDate}`],
    ["Filter", DUPLICATE_ONLY ? "SalesRadix result contains 'Duplicate'" : "All caller IDs (no API check)"],
    ["Ringba search (targetName contains)", RINGBA_SEARCH],
    ["CallGrid scope", CG_CAMPAIGN_IDS.length ? `campaignIds (${CG_CAMPAIGN_IDS.length})` : `name contains "${NAME_CONTAINS}"`],
    ["Ringba records fetched", ringbaRecords.length],
    ["Ringba unique caller IDs", ringbaSet.size],
    ["CallGrid records (in scope)", cgScoped.length],
    ["CallGrid unique caller IDs", cgSet.size],
    ["Total unique caller IDs", union.size],
    ["Checked via SalesRadix", DUPLICATE_ONLY ? uniqueList.length : 0],
    ["Kept (Rejected - Duplicate)", kept.length],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSum["!cols"] = [{ wch: 44 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const summary = {
    ringbaUnique: ringbaSet.size,
    callgridUnique: cgSet.size,
    totalUnique: union.size,
    checked: DUPLICATE_ONLY ? uniqueList.length : 0,
    recordCount: kept.length,
  };
  logger.info(`[idealConcept] done ${JSON.stringify(summary)}`);

  return { buffer, summary };
}

module.exports = { runIdealConceptReport };
