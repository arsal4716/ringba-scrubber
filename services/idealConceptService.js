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

// Keep only "Rejected - Duplicate" records (default). The duplicate result
// is a CallGrid signal; Ringba call logs don't expose it, so Ringba is
// excluded while this is on (set IDEALCONCEPT_DUPLICATE_ONLY=false to grab
// all caller IDs from both sources again).
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

  const detail = []; // every considered record, with the field we filtered on

  // ── Ringba (≈2–48%) — fetch ALL records where targetName CONTAINS term,
  //    then filter by isDuplicate. ──
  report(2, "Fetching Ringba…", 0);
  const ringbaRecords = await ringbaService.fetchCallLogsByTargetName(
    RINGBA_SEARCH,
    { startDate: new Date(dateFrom), endDate: new Date(dateTo) },
    {
      chunkDays: 7,
      comparisonType: "CONTAINS",
      onChunk: (i, total, fetched) =>
        report(Math.round((i / total) * 46), `Ringba ${i}/${total} chunks`, fetched),
    }
  );
  const ringbaKept = ringbaRecords.filter((r) => (DUPLICATE_ONLY ? r.isDuplicate : true));
  const ringbaSet = new Set(ringbaKept.map((r) => toNational10(r.number)).filter(Boolean));
  for (const r of ringbaRecords) {
    detail.push({
      source: "Ringba",
      callerId: toNational10(r.number) || r.number,
      filterField: "isDuplicate",
      filterValue: String(r.isDuplicate),
      kept: DUPLICATE_ONLY ? r.isDuplicate : true,
      name: r.targetName,
      campaign: r.campaignName,
      date: r.callDt ? new Date(r.callDt).toISOString() : "",
    });
  }
  logger.info(`[idealConcept] Ringba records=${ringbaRecords.length} kept=${ringbaKept.length} unique=${ringbaSet.size}`);

  // ── CallGrid (≈50–92%) — fetch in range, name-match, then filter duplicate ──
  report(50, "Fetching CallGrid…", ringbaSet.size);
  const cgRows = await callGridService.fetchCallsForReport({
    startDate,
    endDate,
    campaignIds: CG_CAMPAIGN_IDS,
    onPage: (page, fetched) =>
      report(Math.min(92, 50 + page * 3), `CallGrid page ${page}`, ringbaSet.size + fetched),
  });
  // If we couldn't filter server-side by campaign id, filter by name here.
  const cgScoped = CG_CAMPAIGN_IDS.length ? cgRows : cgRows.filter(nameMatches);
  const cgKept = cgScoped.filter((r) => (DUPLICATE_ONLY ? r.duplicate : true));
  const cgSet = new Set(cgKept.map((r) => toNational10(r.number)).filter(Boolean));
  for (const r of cgScoped) {
    detail.push({
      source: "CallGrid",
      callerId: toNational10(r.number) || r.number,
      filterField: "duplicate",
      filterValue: String(r.duplicate),
      kept: DUPLICATE_ONLY ? r.duplicate : true,
      name: r.destinationName || r.sourceName,
      campaign: r.campaignName,
      date: r.createdAt,
    });
  }
  logger.info(
    `[idealConcept] CallGrid rows=${cgRows.length} scoped=${cgScoped.length} kept=${cgKept.length} unique=${cgSet.size} duplicateOnly=${DUPLICATE_ONLY}`
  );

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

  // Sheet 1 — the deliverable: unique caller IDs.
  const allAoa = [
    ["Caller ID", "Raw (10-digit)", "Source"],
    ...sorted.map((n) => [fmtPhone(n), n, sourceOf(n)]),
  ];
  const wsAll = XLSX.utils.aoa_to_sheet(allAoa);
  wsAll["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsAll, "Unique CallerIDs");

  // Sheet 2 — Detail: every record we considered, the exact field/value we
  // filtered on, and whether it was kept. Lets you verify the filter.
  const DETAIL_CAP = 20000;
  const detailRows = detail.slice(0, DETAIL_CAP);
  const detailAoa = [
    ["Source", "Caller ID", "Filter field", "Filter value", "Kept?", "Target/Destination", "Campaign", "Date"],
    ...detailRows.map((d) => [d.source, d.callerId, d.filterField, d.filterValue, d.kept ? "YES" : "no", d.name, d.campaign, d.date]),
  ];
  const wsDetail = XLSX.utils.aoa_to_sheet(detailAoa);
  wsDetail["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 7 }, { wch: 30 }, { wch: 22 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, wsDetail, "Detail (filter check)");

  // Sheet 3 — Summary.
  const summaryAoa = [
    ["Metric", "Value"],
    ["Date range (Eastern)", startDate === endDate ? startDate : `${startDate} → ${endDate}`],
    ["Filter", DUPLICATE_ONLY ? "Duplicates only (Ringba isDuplicate / CallGrid duplicate)" : "All caller IDs"],
    ["Ringba search (targetName contains)", RINGBA_SEARCH],
    ["CallGrid scope", CG_CAMPAIGN_IDS.length ? `campaignIds (${CG_CAMPAIGN_IDS.length})` : `name contains "${NAME_CONTAINS}"`],
    ["Ringba records fetched", ringbaRecords.length],
    ["Ringba kept (duplicates)", ringbaKept.length],
    ["Ringba unique caller IDs", ringbaSet.size],
    ["CallGrid records (in scope)", cgScoped.length],
    ["CallGrid kept (duplicates)", cgKept.length],
    ["CallGrid unique caller IDs", cgSet.size],
    ["On BOTH", both.length],
    ["Total unique caller IDs", union.size],
    [detail.length > DETAIL_CAP ? `NOTE: Detail truncated to ${DETAIL_CAP} of ${detail.length}` : "", ""],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSum["!cols"] = [{ wch: 44 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const summary = {
    ringbaRecords: ringbaRecords.length,
    ringbaUnique: ringbaSet.size,
    callgridScoped: cgScoped.length,
    callgridUnique: cgSet.size,
    both: both.length,
    recordCount: union.size,
  };
  logger.info(`[idealConcept] done ${JSON.stringify(summary)}`);

  return { buffer, summary };
}

module.exports = { runIdealConceptReport };
