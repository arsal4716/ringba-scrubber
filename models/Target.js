"use strict";

const mongoose = require("mongoose");

/**
 * A Ringba ping-tree target that receives the daily suppression
 * (Bulk Tag) file for a given product.
 *
 * Managed from the "Targets" admin page so the operator can add /
 * edit which Ringba target IDs get updated for each product — no
 * code change required.
 */
const targetSchema = new mongoose.Schema({
  // Friendly label, e.g. "LeadMarket 360-ACA-Xfers-CPL"
  name: { type: String, required: true, trim: true },

  // Which product's number set feeds this target ("ACA" | "SSDI")
  product: { type: String, required: true, trim: true, index: true },

  // Ringba ping-tree target id, e.g. "PI8fbb6def574644169aa43d066ff7cb7d"
  ringbaTargetId: { type: String, required: true, trim: true },

  // When false the daily cron skips this target.
  enabled: { type: Boolean, default: true },

  // ── Last-run bookkeeping (updated by the cron) ──────────────
  lastBulkTagId: { type: String, default: null },
  lastUploadedCount: { type: Number, default: 0 },
  lastUploadedAt: { type: Date, default: null },
  lastStatus: {
    type: String,
    enum: ["Success", "Failed", "Skipped", null],
    default: null,
  },
  lastError: { type: String, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

targetSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

targetSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model("Target", targetSchema);
