"use strict";

/**
 * Normalize a raw phone number to a clean 10-digit US number.
 *
 * Handles:
 *   10 digits        → use as-is
 *   11 digits, 1XXX  → strip leading 1 → 10 digits
 *   +1XXXXXXXXXX     → strip +1 → 10 digits
 *   (XXX) XXX-XXXX   → strip formatting → 10 digits
 *   XXX-XXX-XXXX     → strip formatting → 10 digits
 *   < 10 digits      → Invalid Number
 *   > 10 digits (not 11 starting with 1) → Invalid Number
 *
 * @param {string|number} raw
 * @returns {{ original: string, normalized: string, valid: boolean }}
 */
function normalizePhone(raw) {
  const original = raw !== undefined && raw !== null ? String(raw).trim() : "";

  if (!original) {
    return { original, normalized: "", valid: false };
  }

  // Remove all non-digit characters
  let digits = original.replace(/\D/g, "");

  // Handle 11-digit numbers starting with 1 (US country code)
  if (digits.length === 11 && digits[0] === "1") {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) {
    return { original, normalized: digits, valid: false };
  }

  return { original, normalized: digits, valid: true };
}

/**
 * Convert a 10-digit number to the DNC stored format (+1XXXXXXXXXX).
 * The dncService stores numbers as "+1XXXXXXXXXX".
 */
function toDNCFormat(digits10) {
  return "+1" + digits10;
}

module.exports = { normalizePhone, toDNCFormat };
