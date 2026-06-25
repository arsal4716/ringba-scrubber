"use strict";

const moment = require("moment-timezone");
const Publisher = require("../models/Publisher");
const ScrubJob = require("../models/ScrubJob");
const { AVAILABLE_CAMPAIGNS } = require("../config/constants");

const APP_TZ = process.env.APP_TIMEZONE || "Asia/Karachi";

// ─── GET /api/admin/scrub-jobs ────────────────────────────────
// Publisher-uploaded scrub files, with optional date + publisher
// filters. Defaults to TODAY (app timezone) and never loads the whole
// collection: filtered by indexed createdAt/publisherName, projected,
// and capped.
const getScrubJobs = async (req, res) => {
  try {
    const { date, publisherName, limit } = req.query;

    // Day window in the app timezone (default = today).
    const day = date ? moment.tz(date, "YYYY-MM-DD", APP_TZ) : moment.tz(APP_TZ);
    if (!day.isValid()) {
      return res.status(400).json({ error: "Invalid date (use YYYY-MM-DD)" });
    }
    const start = day.clone().startOf("day").toDate();
    const end = day.clone().endOf("day").toDate();

    const query = { createdAt: { $gte: start, $lte: end } };
    if (publisherName && publisherName.trim()) {
      query.publisherName = publisherName.trim();
    }

    const cap = Math.min(Number(limit) || 200, 500);

    const jobs = await ScrubJob.find(query)
      .select(
        "publisherName campaign originalFileName status totalRows duplicateCount dncCount invalidCount nonDuplicateCount downloadFilePath createdAt completedAt"
      )
      .sort({ createdAt: -1 })
      .limit(cap)
      .lean();

    res.json({ jobs, count: jobs.length, date: day.format("YYYY-MM-DD") });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ─── GET /api/admin/publishers ────────────────────────────────
const getPublishers = async (req, res) => {
  try {
    const publishers = await Publisher.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({ publishers, availableCampaigns: AVAILABLE_CAMPAIGNS });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ─── POST /api/admin/publishers ───────────────────────────────
const createPublisher = async (req, res) => {
  try {
    const { publisherName, allowedCampaigns } = req.body;
    if (!publisherName || !publisherName.trim()) {
      return res.status(400).json({ error: "publisherName is required" });
    }

    const validated = (allowedCampaigns || []).filter((c) =>
      AVAILABLE_CAMPAIGNS.includes(c)
    );

    const publisher = await Publisher.create({
      publisherName: publisherName.trim(),
      allowedCampaigns: validated,
    });

    res.status(201).json(publisher);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Publisher name already exists" });
    }
    res.status(500).json({ error: "Server error" });
  }
};

// ─── PUT /api/admin/publishers/:id ───────────────────────────
const updatePublisher = async (req, res) => {
  try {
    const { publisherName, allowedCampaigns } = req.body;

    if (!publisherName || !publisherName.trim()) {
      return res.status(400).json({ error: "publisherName is required" });
    }

    const validated = (allowedCampaigns || []).filter((c) =>
      AVAILABLE_CAMPAIGNS.includes(c)
    );

    const publisher = await Publisher.findByIdAndUpdate(
      req.params.id,
      {
        publisherName: publisherName.trim(),
        allowedCampaigns: validated,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    );

    if (!publisher) {
      return res.status(404).json({ error: "Publisher not found" });
    }

    res.json(publisher);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Publisher name already exists" });
    }
    res.status(500).json({ error: "Server error" });
  }
};

// ─── DELETE /api/admin/publishers/:id ────────────────────────
const deletePublisher = async (req, res) => {
  try {
    const publisher = await Publisher.findByIdAndDelete(req.params.id);
    if (!publisher) {
      return res.status(404).json({ error: "Publisher not found" });
    }
    res.json({ success: true, message: "Publisher deleted" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  getPublishers,
  createPublisher,
  updatePublisher,
  deletePublisher,
  getScrubJobs,
};
