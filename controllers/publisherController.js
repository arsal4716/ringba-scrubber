"use strict";

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Publisher = require("../models/Publisher");
const ScrubJob = require("../models/ScrubJob");
const scrubService = require("../services/scrubService");
const logger = require("../utils/logger");

// ─── Ensure upload dir ────────────────────────────────────────
const INPUT_DIR = path.join(__dirname, "../uploads/scrub-input");
fs.mkdirSync(INPUT_DIR, { recursive: true });

// ─── Multer config ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INPUT_DIR),
  filename: (req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `upload-${suffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".csv", ".xlsx", ".xls"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV, XLSX, and XLS files are allowed"));
    }
  },
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
}).single("file");

// ─── Case-insensitive publisher lookup ───────────────────────
async function findPublisher(name) {
  return Publisher.findOne({
    publisherName: { $regex: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
  }).lean();
}

// ─── POST /api/publisher/verify ──────────────────────────────
const verifyPublisher = async (req, res) => {
  try {
    const { publisherName } = req.body;
    if (!publisherName) {
      return res.status(400).json({ error: "publisherName is required" });
    }

    const publisher = await findPublisher(publisherName);
    if (!publisher) {
      return res.status(404).json({ error: "Publisher not found. Contact your administrator." });
    }

    res.json({
      found: true,
      publisherName: publisher.publisherName,
      allowedCampaigns: publisher.allowedCampaigns,
    });
  } catch (err) {
    logger.error("verifyPublisher error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── POST /api/publisher/upload ──────────────────────────────
const uploadFile = (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { publisherName, campaign } = req.body;

    if (!publisherName || !campaign) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "publisherName and campaign are required" });
    }

    try {
      // Verify publisher
      const publisher = await findPublisher(publisherName);
      if (!publisher) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: "Publisher not found" });
      }

      // Check campaign permission
      if (!publisher.allowedCampaigns.includes(campaign)) {
        fs.unlink(req.file.path, () => {});
        return res
          .status(403)
          .json({ error: `Campaign "${campaign}" is not allowed for this publisher` });
      }

      // Create job record
      const job = await ScrubJob.create({
        publisherName: publisher.publisherName,
        campaign,
        originalFileName: req.file.originalname,
        storedFilePath: req.file.path,
        status: "queued",
      });

      // Start processing asynchronously (do NOT await)
      scrubService.processJob(job._id.toString()).catch((e) => {
        logger.error(`Async processJob error for ${job._id}: ${e.message}`);
      });

      res.json({ jobId: job._id, message: "File uploaded. Processing started." });
    } catch (err) {
      fs.unlink(req.file.path, () => {});
      logger.error("uploadFile error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });
};

// ─── GET /api/publisher/job/:jobId ────────────────────────────
const getJobStatus = async (req, res) => {
  try {
    const job = await ScrubJob.findById(req.params.jobId).lean();
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ─── GET /api/publisher/job/:jobId/download ───────────────────
const downloadResult = async (req, res) => {
  try {
    const job = await ScrubJob.findById(req.params.jobId).lean();
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.status !== "completed") {
      return res.status(400).json({ error: "Job is not yet completed" });
    }
    if (!job.downloadFilePath) {
      return res.status(404).json({ error: "Output file not found" });
    }

    const filePath = path.join(
      __dirname,
      "../uploads/scrub-output",
      job.downloadFilePath
    );

    const downloadName = `scrubbed_${job.campaign.replace(/\s+/g, "_")}_${path
      .basename(job.originalFileName, path.extname(job.originalFileName))
      .slice(0, 40)}.csv`;

    res.download(filePath, downloadName, (err) => {
      if (err) {
        logger.error(`Download error: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: "Download failed" });
        }
      }
    });
  } catch (err) {
    logger.error("downloadResult error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── GET /api/publisher/jobs ──────────────────────────────────
const getPublisherJobs = async (req, res) => {
  try {
    const { publisherName } = req.query;
    const query = publisherName ? { publisherName } : {};
    const jobs = await ScrubJob.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  verifyPublisher,
  uploadFile,
  getJobStatus,
  downloadResult,
  getPublisherJobs,
};
