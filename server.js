"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const moment = require("moment-timezone");
const fs = require("fs");

const connectDB = require("./config/db");
const apiRoutes = require("./routes/api");

const { startAutoDeleteCron } = require("./cron/autoDeleteCron");
const { scheduleFetchJob } = require("./cron/fetchCron");

const Job = require("./models/Job");
const scrubService = require("./services/scrubService");
const logger = require("./utils/logger");

// ─── Ensure required upload directories exist ─────────────────
[
  "uploads/generated",
  "uploads/dnc",
  "uploads/scrub-input",
  "uploads/scrub-output",
].forEach((dir) => {
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
});

// ─── Express + HTTP Server ────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── Socket.IO ────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : ["http://localhost:5173", "http://localhost:5001","http://72.60.233.42:5000/"];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,  
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Inject io into scrubService for real-time progress emission
scrubService.setIO(io);

// ─── Database ─────────────────────────────────────────────────
connectDB();

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Static file serving ──────────────────────────────────────
app.use(
  "/uploads/generated",
  express.static(path.join(__dirname, "uploads/generated"))
);

// ─── API Routes ───────────────────────────────────────────────
app.use("/api", apiRoutes);

// ─── Frontend (production build) ──────────────────────────────
const FRONTEND_DIST = path.join(__dirname, "frontend", "dist");
const FRONTEND_INDEX = path.join(FRONTEND_DIST, "index.html");

app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(FRONTEND_INDEX, (err) => {
    if (err) {
      res.status(404).json({
        message:
          "Frontend build not found. Run: cd frontend && npm run build",
      });
    }
  });
});

// ─── Socket.IO room management ────────────────────────────────
io.on("connection", (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on("join:job", (jobId) => {
    socket.join(`job:${jobId}`);
    logger.info(`Socket ${socket.id} joined room job:${jobId}`);
  });

  socket.on("leave:job", (jobId) => {
    socket.leave(`job:${jobId}`);
  });

  socket.on("disconnect", () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// ─── Cron initialization ──────────────────────────────────────
const initCron = async () => {
  startAutoDeleteCron({
    timezone: process.env.APP_TIMEZONE || "Asia/Karachi",
    daysToKeep: Number(process.env.FILE_RETENTION_DAYS) || 7,
  });

  const lastJob = await Job.findOne().sort({ createdAt: -1 }).lean();

  if (lastJob && lastJob.runTime && lastJob.timezone) {
    scheduleFetchJob(lastJob.runTime, lastJob.timezone);
    return;
  }

  const tz = process.env.APP_TIMEZONE || "Asia/Karachi";
  const now = moment.tz(tz);
  const next = now.clone().hour(8).minute(0).second(0).millisecond(0);
  if (next.isSameOrBefore(now)) next.add(1, "day");

  const job = await Job.create({ runTime: next.toDate(), timezone: tz });
  scheduleFetchJob(job.runTime, job.timezone);
};

initCron().catch((e) => {
  logger.error("Cron init failed:", e?.message || e);
});

// ─── Start server ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Socket.IO enabled`);
});
