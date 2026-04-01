const mongoose = require("mongoose");

const dncSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true, index: true },
  uploadedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("DNC", dncSchema);
