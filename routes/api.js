const express = require("express");
const router = express.Router();

// ─── Auth ─────────────────────────────────────────────────────
const { login } = require("../controllers/authController");
router.post("/auth/login", login);

// ─── Preserved controllers ────────────────────────────────────
const { saveSchedule, getSchedule } = require("../controllers/scheduleController");
const { uploadDNC } = require("../controllers/dncController");
const { getFiles, downloadFile, deleteFile } = require("../controllers/filesController");
const { getDashboard } = require("../controllers/dashboardController");

// ─── New controllers ──────────────────────────────────────────
const {
  getPublishers,
  createPublisher,
  updatePublisher,
  deletePublisher,
} = require("../controllers/adminController");

const {
  verifyPublisher,
  uploadFile,
  getJobStatus,
  downloadResult,
  getPublisherJobs,
} = require("../controllers/publisherController");

// ─── Schedule (existing) ──────────────────────────────────────
router.get("/schedule", getSchedule);
router.post("/schedule", saveSchedule);

// ─── DNC (existing) ───────────────────────────────────────────
router.post("/dnc/upload", uploadDNC);

// ─── Files (existing) ─────────────────────────────────────────
router.get("/files", getFiles);
router.get("/files/:id/download", downloadFile);
router.delete("/files/:id", deleteFile);

// ─── Dashboard (existing) ─────────────────────────────────────
router.get("/dashboard", getDashboard);

// ─── Admin - Publisher management (NEW) ──────────────────────
router.get("/admin/publishers", getPublishers);
router.post("/admin/publishers", createPublisher);
router.put("/admin/publishers/:id", updatePublisher);
router.delete("/admin/publishers/:id", deletePublisher);

// ─── Publisher - Scrub workflow (NEW) ─────────────────────────
router.post("/publisher/verify", verifyPublisher);
router.post("/publisher/upload", uploadFile);
router.get("/publisher/jobs", getPublisherJobs);
router.get("/publisher/job/:jobId", getJobStatus);
router.get("/publisher/job/:jobId/download", downloadResult);

module.exports = router;
