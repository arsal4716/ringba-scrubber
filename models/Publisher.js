const mongoose = require("mongoose");

const publisherSchema = new mongoose.Schema({
  publisherName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  allowedCampaigns: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

publisherSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

publisherSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model("Publisher", publisherSchema);
