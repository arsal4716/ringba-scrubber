"use strict";

const Target = require("../models/Target");
const { ACTIVE_PRODUCTS } = require("../config/constants");
const { executeFetch } = require("../cron/fetchCron");
const logger = require("../utils/logger");

// ─── GET /api/targets ─────────────────────────────────────────
const getTargets = async (req, res) => {
  try {
    const targets = await Target.find().sort({ product: 1, createdAt: -1 }).lean();
    res.json({ targets, availableProducts: ACTIVE_PRODUCTS });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

function validatePayload(body) {
  const name = (body.name || "").trim();
  const product = (body.product || "").trim();
  const ringbaTargetId = (body.ringbaTargetId || "").trim();

  if (!name) return { error: "name is required" };
  if (!product || !ACTIVE_PRODUCTS.includes(product)) {
    return { error: `product must be one of: ${ACTIVE_PRODUCTS.join(", ")}` };
  }
  if (!ringbaTargetId) return { error: "ringbaTargetId is required" };

  return {
    value: {
      name,
      product,
      ringbaTargetId,
      enabled: body.enabled !== false,
    },
  };
}

// ─── POST /api/targets ────────────────────────────────────────
const createTarget = async (req, res) => {
  try {
    const { value, error } = validatePayload(req.body);
    if (error) return res.status(400).json({ error });

    const target = await Target.create(value);
    res.status(201).json(target);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ─── PUT /api/targets/:id ─────────────────────────────────────
const updateTarget = async (req, res) => {
  try {
    const { value, error } = validatePayload(req.body);
    if (error) return res.status(400).json({ error });

    const target = await Target.findByIdAndUpdate(req.params.id, value, {
      new: true,
      runValidators: true,
    });
    if (!target) return res.status(404).json({ error: "Target not found" });

    res.json(target);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ─── DELETE /api/targets/:id ──────────────────────────────────
const deleteTarget = async (req, res) => {
  try {
    const target = await Target.findByIdAndDelete(req.params.id);
    if (!target) return res.status(404).json({ error: "Target not found" });
    res.json({ success: true, message: "Target deleted" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ─── POST /api/targets/run ────────────────────────────────────
// Trigger the full fetch -> file -> sheet -> Ringba-upload flow now.
// Runs in the background so the request returns immediately.
const runNow = async (req, res) => {
  try {
    const timezone = process.env.APP_TIMEZONE || "Asia/Karachi";
    logger.info("[targets] Manual run triggered");

    // Fire and forget — progress is visible in server logs + Targets table.
    executeFetch(timezone).catch((err) =>
      logger.error(`[targets] Manual run failed: ${err?.message || err}`)
    );

    res.json({ success: true, message: "Fetch + upload started" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  getTargets,
  createTarget,
  updateTarget,
  deleteTarget,
  runNow,
};
