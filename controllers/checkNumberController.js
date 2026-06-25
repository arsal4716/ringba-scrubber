"use strict";

const Call = require("../models/Call");
const DNC = require("../models/DNC");
const { normalizePhone } = require("../utils/phoneNormalizer");

// Product whose saved numbers count as "duplicates" for this check.
const CHECK_CAMPAIGN = "ACA";

/**
 * POST /check-number   (root-level, used by an external integration)
 *
 *   request:  { "phone": "14092384126" }
 *   response: { "success": true, "phone": "4092384126", "status": "Duplicate" }
 *
 * A number is "Duplicate" if it already exists in the ACA Call DB OR in
 * the DNC list. Kept deliberately tiny and index-only (two parallel
 * `exists` lookups) so it responds well under 1s.
 */
const checkNumber = async (req, res) => {
  try {
    const { phone } = req.body || {};
    const parsed = normalizePhone(phone);

    if (!parsed.valid) {
      return res
        .status(400)
        .json({ success: false, phone: String(phone || ""), error: "Invalid phone number" });
    }

    // Numbers are stored in mixed historical formats, so match any of:
    //   national 10-digit, 1XXXXXXXXXX, +1XXXXXXXXXX
    const variants = [parsed.national, parsed.normalized, parsed.e164];

    const [acaHit, dncHit] = await Promise.all([
      Call.exists({ campaignName: CHECK_CAMPAIGN, phoneNumber: { $in: variants } }),
      DNC.exists({ phoneNumber: { $in: variants } }),
    ]);

    const status = acaHit || dncHit ? "Duplicate" : "Not Duplicate";

    return res.json({ success: true, phone: parsed.national, status });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { checkNumber };
