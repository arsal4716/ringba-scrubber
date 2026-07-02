const mongoose = require("mongoose");

// Tracks incremental fetch state for append-model sources (e.g. Kaliper),
// so we only pull new days and append instead of re-fetching history.
const sourceStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true }, // e.g. "kaliper"
  lastDate: { type: String }, // YYYY-MM-DD — last day fully fetched
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SourceState", sourceStateSchema);
