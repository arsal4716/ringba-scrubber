"use strict";

const Publisher = require("../models/Publisher");
const { AVAILABLE_CAMPAIGNS } = require("../config/constants");

// ─── GET /api/admin/publishers ────────────────────────────────
const getPublishers = async (req, res) => {
  try {
    const publishers = await Publisher.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({ publishers, availableCampaigns: AVAILABLE_CAMPAIGNS });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ─── POST /api/admin/publishers ───────────────────────────────
const createPublisher = async (req, res) => {
  try {
    const { publisherName, allowedCampaigns } = req.body;
    if (!publisherName || !publisherName.trim()) {
      return res.status(400).json({ error: "publisherName is required" });
    }

    const validated = (allowedCampaigns || []).filter((c) =>
      AVAILABLE_CAMPAIGNS.includes(c)
    );

    const publisher = await Publisher.create({
      publisherName: publisherName.trim(),
      allowedCampaigns: validated,
    });

    res.status(201).json(publisher);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Publisher name already exists" });
    }
    res.status(500).json({ error: "Server error" });
  }
};

// ─── PUT /api/admin/publishers/:id ───────────────────────────
const updatePublisher = async (req, res) => {
  try {
    const { publisherName, allowedCampaigns } = req.body;

    if (!publisherName || !publisherName.trim()) {
      return res.status(400).json({ error: "publisherName is required" });
    }

    const validated = (allowedCampaigns || []).filter((c) =>
      AVAILABLE_CAMPAIGNS.includes(c)
    );

    const publisher = await Publisher.findByIdAndUpdate(
      req.params.id,
      {
        publisherName: publisherName.trim(),
        allowedCampaigns: validated,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    );

    if (!publisher) {
      return res.status(404).json({ error: "Publisher not found" });
    }

    res.json(publisher);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "Publisher name already exists" });
    }
    res.status(500).json({ error: "Server error" });
  }
};

// ─── DELETE /api/admin/publishers/:id ────────────────────────
const deletePublisher = async (req, res) => {
  try {
    const publisher = await Publisher.findByIdAndDelete(req.params.id);
    if (!publisher) {
      return res.status(404).json({ error: "Publisher not found" });
    }
    res.json({ success: true, message: "Publisher deleted" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  getPublishers,
  createPublisher,
  updatePublisher,
  deletePublisher,
};
