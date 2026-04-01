const mongoose = require("mongoose");

const callSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, index: true },
  campaignName: { type: String, required: true, index: true },
  fetchType: { type: String, enum: ["45days", "1year"], required: true },
  fetchedAt: { type: Date, default: Date.now, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

// Unique index to avoid duplicate inserts
callSchema.index(
  { phoneNumber: 1, campaignName: 1, fetchType: 1 },
  { unique: true }
);

module.exports = mongoose.model("Call", callSchema);
