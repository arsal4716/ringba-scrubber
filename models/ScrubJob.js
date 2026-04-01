const mongoose = require("mongoose");

const scrubJobSchema = new mongoose.Schema({
  publisherName: { type: String, required: true, index: true },
  campaign: { type: String, required: true },
  originalFileName: { type: String, required: true },
  storedFilePath: { type: String, required: true },

  status: {
    type: String,
    enum: ["queued", "processing", "completed", "failed"],
    default: "queued",
    index: true,
  },

  // ─── Processing stats ──────────────────────────────────────
  totalRows: { type: Number, default: 0 },
  processedRows: { type: Number, default: 0 },
  duplicateCount: { type: Number, default: 0 },
  dncCount: { type: Number, default: 0 },
  invalidCount: { type: Number, default: 0 },
  nonDuplicateCount: { type: Number, default: 0 },

  // ─── Timestamps ────────────────────────────────────────────
  createdAt: { type: Date, default: Date.now, index: true },
  startedAt: { type: Date },
  completedAt: { type: Date },

  // ─── Output ────────────────────────────────────────────────
  downloadFilePath: { type: String },
  errorMessage: { type: String },
});

module.exports = mongoose.model("ScrubJob", scrubJobSchema);
