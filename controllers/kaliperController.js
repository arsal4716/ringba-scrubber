"use strict";

const { runKaliperReport } = require("../services/kaliperService");
const logger = require("../utils/logger");

// Build the [from, to) window for a given YYYY-MM-DD report date.
// Matches the reference window: 04:00Z that day → 04:00Z next day
// (i.e. ET midnight-to-midnight).
function windowForDate(dateStr) {
  const from = `${dateStr}T04:00:00.000Z`;
  const next = new Date(`${dateStr}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const to = `${next.toISOString().slice(0, 10)}T04:00:00.000Z`;
  return { dateFrom: from, dateTo: to };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/kaliper/run
 *   body: { date: "YYYY-MM-DD" }            (defaults to yesterday)
 *      or { dateFrom, dateTo }              (explicit ISO override)
 *
 * Runs the Kaliper pull synchronously and streams back an .xlsx download.
 */
const runKaliper = async (req, res) => {
  try {
    let { date, dateFrom, dateTo } = req.body || {};
    let label;

    if (dateFrom && dateTo) {
      label = `${dateFrom} .. ${dateTo}`;
    } else {
      if (!date) {
        // default = yesterday (UTC)
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 1);
        date = d.toISOString().slice(0, 10);
      }
      if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: "date must be YYYY-MM-DD" });
      }
      ({ dateFrom, dateTo } = windowForDate(date));
      label = date;
    }

    const { buffer, summary } = await runKaliperReport({ dateFrom, dateTo, label });

    const fileName = `Suppressed_CallerIDs_${(label || "report").replace(/[^\w.-]/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    // Expose the summary so the page can show stats without parsing the file.
    res.setHeader("X-Kaliper-Summary", JSON.stringify(summary));
    res.setHeader("Access-Control-Expose-Headers", "X-Kaliper-Summary, Content-Disposition");

    return res.send(buffer);
  } catch (err) {
    logger.error(`[kaliper] run failed: ${err?.message || err}`);
    return res.status(500).json({ error: err?.message || "Kaliper run failed" });
  }
};

module.exports = { runKaliper };
