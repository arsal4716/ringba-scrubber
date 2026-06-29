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
const { toNational10 } = require("../utils/phoneNormalizer");
const logger = require("../utils/logger");

const RINGBA_SEARCH = process.env.IDEALCONCEPT_RINGBA_SEARCH || "IdealConcept";
const NAME_CONTAINS = (process.env.IDEALCONCEPT_NAME_CONTAINS || "IdealConcept").toLowerCase();
const CG_CAMPAIGN_IDS = (process.env.IDEALCONCEPT_CALLGRID_CAMPAIGN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

  // ── Ringba (≈2–50%) — caller IDs where targetName CONTAINS the term ──
  report(2, "Fetching Ringba…", 0);
  const ringbaRes = await ringbaService.fetchNumbersForTargetNameChunked(
    RINGBA_SEARCH,
    { startDate: new Date(dateFrom), endDate: new Date(dateTo) },
    0,
    {
      chunkDays: 1,
      comparisonType: "CONTAINS",
      onChunk: (i, total, fetched) =>
        report(Math.round((i / total) * 48), `Ringba ${i}/${total} chunks`, fetched),
    }
  );
  const ringbaSet = new Set((ringbaRes.numbers || []).map(toNational10).filter(Boolean));
  logger.info(`[idealConcept] Ringba unique=${ringbaSet.size}`);

  // ── CallGrid (≈50–92%) ──
  report(50, "Fetching CallGrid…", ringbaSet.size);
  const cgRows = await callGridService.fetchCallsForReport({
    startDate,
    endDate,
    campaignIds: CG_CAMPAIGN_IDS,
    onPage: (page, fetched) =>
      report(Math.min(92, 50 + page * 3), `CallGrid page ${page}`, ringbaSet.size + fetched),
  });
  // If we couldn't filter server-side by campaign id, filter by name here.
  const cgFiltered = CG_CAMPAIGN_IDS.length ? cgRows : cgRows.filter(nameMatches);
  const cgSet = new Set(cgFiltered.map((r) => toNational10(r.number)).filter(Boolean));
  logger.info(`[idealConcept] CallGrid rows=${cgRows.length} matched=${cgFiltered.length} unique=${cgSet.size}`);

  // ── Union + build workbook (≈95%) ──
  report(95, "Building workbook…", ringbaSet.size + cgSet.size);
  const union = new Set([...ringbaSet, ...cgSet]);
  const both = [...union].filter((n) => ringbaSet.has(n) && cgSet.has(n));

  const sourceOf = (n) => {
    const r = ringbaSet.has(n), c = cgSet.has(n);
    return r && c ? "Ringba + CallGrid" : r ? "Ringba" : "CallGrid";
  };

  const sorted = [...union].sort();
  const wb = XLSX.utils.book_new();

  const allAoa = [
    ["Caller ID", "Raw (10-digit)", "Source"],
    ...sorted.map((n) => [fmtPhone(n), n, sourceOf(n)]),
  ];
  const wsAll = XLSX.utils.aoa_to_sheet(allAoa);
  wsAll["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsAll, "Unique CallerIDs");

  const summaryAoa = [
    ["Metric", "Value"],
    ["Date range", startDate === endDate ? startDate : `${startDate} → ${endDate}`],
    ["Ringba search (targetName contains)", RINGBA_SEARCH],
    ["CallGrid filter", CG_CAMPAIGN_IDS.length ? `campaignIds (${CG_CAMPAIGN_IDS.length})` : `name contains "${NAME_CONTAINS}"`],
    ["Ringba unique caller IDs", ringbaSet.size],
    ["CallGrid unique caller IDs", cgSet.size],
    ["On BOTH", both.length],
    ["Total unique caller IDs", union.size],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSum["!cols"] = [{ wch: 40 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const summary = {
    ringbaUnique: ringbaSet.size,
    callgridUnique: cgSet.size,
    both: both.length,
    recordCount: union.size,
  };
  logger.info(`[idealConcept] done ${JSON.stringify(summary)}`);

  return { buffer, summary };
}

module.exports = { runIdealConceptReport };
