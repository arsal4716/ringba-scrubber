const express = require("express");
const router = express.Router();
const { login } = require("../controllers/authController");
router.post("/auth/login", login);
const { saveSchedule, getSchedule } = require("../controllers/scheduleController");
const { uploadDNC, getDNCCount } = require("../controllers/dncController");
const { getFiles, downloadFile, deleteFile } = require("../controllers/filesController");
const { getDashboard } = require("../controllers/dashboardController");

const {
  getPublishers,
  createPublisher,
  updatePublisher,
  deletePublisher,
  getScrubJobs,
} = require("../controllers/adminController");

const {
  verifyPublisher,
  uploadFile,
  getJobStatus,
  downloadResult,
  getPublisherJobs,
} = require("../controllers/publisherController");

const {
  getTargets,
  createTarget,
  updateTarget,
  deleteTarget,
  runNow,
} = require("../controllers/targetController");

const { runKaliper } = require("../controllers/kaliperController");

const {
  runReport,
  listReports,
  getReport,
  downloadReport,
} = require("../controllers/reportController");

// ─── Schedule (existing) ──────────────────────────────────────
router.get("/schedule", getSchedule);
router.post("/schedule", saveSchedule);

// ─── DNC (existing) ───────────────────────────────────────────
router.post("/dnc/upload", uploadDNC);
router.get("/dnc/count", getDNCCount);

// ─── Files (existing) ─────────────────────────────────────────
router.get("/files", getFiles);
router.get("/files/:id/download", downloadFile);
router.delete("/files/:id", deleteFile);

// ─── Dashboard (existing) ─────────────────────────────────────
router.get("/dashboard", getDashboard);

// ─── Admin - Publisher management (NEW) ──────────────────────
router.get("/admin/publishers", getPublishers);
router.get("/admin/scrub-jobs", getScrubJobs);
router.post("/admin/publishers", createPublisher);
router.put("/admin/publishers/:id", updatePublisher);
router.delete("/admin/publishers/:id", deletePublisher);

// ─── Targets - Ringba upload automation (NEW) ─────────────────
router.get("/targets", getTargets);
router.post("/targets", createTarget);
router.post("/targets/run", runNow);
router.put("/targets/:id", updateTarget);
router.delete("/targets/:id", deleteTarget);

// ─── Kaliper - Suppressed CallerID report (NEW) ───────────────
router.post("/kaliper/run", runKaliper);

// ─── Background report jobs (Kaliper / IdealConcept) ──────────
router.post("/reports/run", runReport);
router.get("/reports", listReports);
router.get("/reports/:id", getReport);
router.get("/reports/:id/download", downloadReport);

// ─── Publisher - Scrub workflow (NEW) ─────────────────────────
router.post("/publisher/verify", verifyPublisher);
router.post("/publisher/upload", uploadFile);
router.get("/publisher/jobs", getPublisherJobs);
router.get("/publisher/job/:jobId", getJobStatus);
router.get("/publisher/job/:jobId/download", downloadResult);

module.exports = router;
