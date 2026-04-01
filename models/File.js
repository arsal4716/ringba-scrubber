const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  filePath: { type: String },
  campaignName: { type: String, required: true },
  fetchType: { type: String, enum: ["45days", "1year", "combined"] },
  totalNumbers: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("File", fileSchema);
