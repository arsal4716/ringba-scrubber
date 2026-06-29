const mongoose = require("mongoose");

// A long-running, downloadable report (Kaliper, IdealConcept, …).
// Persisted so progress survives a page reload and the finished file
// stays available for later download.
const reportJobSchema = new mongoose.Schema({
  type: { type: String, required: true, index: true }, // 'kaliper' | 'idealconcept'
  label: { type: String }, // friendly name shown in the UI
  status: {
    type: String,
    enum: ["queued", "processing", "completed", "failed"],
    default: "queued",
    index: true,
  },
  params: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Live progress
  phase: { type: String, default: "" },
  fetched: { type: Number, default: 0 },
  percent: { type: Number, default: 0 },

  // Result
  summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  recordCount: { type: Number, default: 0 },
  fileName: { type: String },
  filePath: { type: String },
  error: { type: String },

  createdAt: { type: Date, default: Date.now, index: true },
  startedAt: { type: Date },
  completedAt: { type: Date },
});

module.exports = mongoose.model("ReportJob", reportJobSchema);
