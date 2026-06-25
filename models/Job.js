const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({
  runTime: { type: Date, required: true },
  timezone: {
    type: String,
    enum: ["Asia/Karachi", "America/New_York"],
    required: true,
  },
  lastRunStatus: {
    type: String,
    enum: ["Running", "Success", "Failed"],
    default: null,
  },
  lastRunAt: { type: Date },
  totalFetched: { type: Number, default: 0 },
  totalUniqueAfterDedup: { type: Number, default: 0 },
  totalAfterDNCRemoval: { type: Number, default: 0 },
  totalSaved: { type: Number, default: 0 },
  perCampaignStats: [
    {
      campaignName: String,
      fetchedCount: Number,
      afterDedup: Number,
      afterDNC: Number,
      finalSaved: Number,
      // Per-source breakdown (ringba / qc / callgrid)
      sources: [
        {
          source: String,
          fetched: Number,
          saved: Number,
        },
      ],
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Job", jobSchema);
