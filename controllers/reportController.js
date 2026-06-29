"use strict";

const path = require("path");
const fs = require("fs");

const ReportJob = require("../models/ReportJob");
const reportService = require("../services/reportService");
const logger = require("../utils/logger");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES = ["kaliper", "idealconcept"];

// POST /api/reports/run  { type, startDate, endDate }
const runReport = async (req, res) => {
  try {
    const { type, startDate, endDate } = req.body || {};
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: "Invalid report type" });
    }
    if (!DATE_RE.test(startDate || "") || !DATE_RE.test(endDate || "")) {
      return res.status(400).json({ error: "startDate and endDate must be YYYY-MM-DD" });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: "startDate must be on or before endDate" });
    }

    const job = await reportService.createAndRun(type, { startDate, endDate });
    res.json({ jobId: job._id, status: job.status, label: job.label });
  } catch (err) {
    logger.error(`[report] run failed: ${err?.message || err}`);
    res.status(500).json({ error: err?.message || "Failed to start report" });
  }
};

// GET /api/reports?type=&limit=  — recent jobs (newest first)
const listReports = async (req, res) => {
  try {
    const { type, limit } = req.query;
    const query = {};
    if (type && VALID_TYPES.includes(type)) query.type = type;

    const cap = Math.min(Number(limit) || 50, 200);
    const jobs = await ReportJob.find(query)
      .select("type label status percent phase fetched recordCount fileName summary error createdAt completedAt")
      .sort({ createdAt: -1 })
      .limit(cap)
      .lean();

    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/reports/:id  — single job (for polling)
const getReport = async (req, res) => {
  try {
    const job = await ReportJob.findById(req.params.id)
      .select("type label status percent phase fetched recordCount fileName summary error createdAt completedAt")
      .lean();
    if (!job) return res.status(404).json({ error: "Report not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/reports/:id/download
const downloadReport = async (req, res) => {
  try {
    const job = await ReportJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ error: "Report not found" });
    if (job.status !== "completed" || !job.filePath) {
      return res.status(400).json({ error: "Report is not ready" });
    }
    if (!fs.existsSync(job.filePath)) {
      return res.status(404).json({ error: "File no longer available" });
    }
    res.download(job.filePath, job.fileName || path.basename(job.filePath));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = { runReport, listReports, getReport, downloadReport };
