"use strict";

function normalizePhone(input) {
  const original = input == null ? "" : String(input).trim();
  if (!original) {
    return { original, normalized: "", valid: false };
  }

  let digits = original.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) {
    return { original, normalized: "", valid: false };
  }

  return {
    original,
    normalized: digits,
    valid: true,
  };
}

function toDNCFormat(phone10) {
  const { normalized, valid } = normalizePhone(phone10);
  if (!valid) return "";
  return `+1${normalized}`;
}
function toE164(phone10) {
  const { normalized, valid } = normalizePhone(phone10);
  if (!valid) return "";
  return `+1${normalized}`;
}

module.exports = {
  normalizePhone,
  toDNCFormat,
  toE164,
};