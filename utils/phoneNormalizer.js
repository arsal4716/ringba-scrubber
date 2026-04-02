"use strict";

function normalizePhone(input) {
  const original = input == null ? "" : String(input).trim();
  if (!original) {
    return {
      original,
      normalized: "", 
      national: "",    
      e164: "",         
      valid: false,
    };
  }

  let digits = original.replace(/\D/g, "");
  if (!digits) {
    return {
      original,
      normalized: "",
      national: "",
      e164: "",
      valid: false,
    };
  }
  if (digits.length === 10) {
    digits = `1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
  } else if (digits.length > 11) {
    const last11 = digits.slice(-11);
    if (last11.length === 11 && last11.startsWith("1")) {
      digits = last11;
    } else {
      const last10 = digits.slice(-10);
      if (last10.length === 10) {
        digits = `1${last10}`;
      }
    }
  }

  if (!(digits.length === 11 && digits.startsWith("1"))) {
    return {
      original,
      normalized: "",
      national: "",
      e164: "",
      valid: false,
    };
  }

  const national = digits.slice(1);

  return {
    original,
    normalized: digits,     
    national,               
    e164: `+${digits}`,    
    valid: true,
  };
}

function toStorageFormat(phone) {
  const { normalized, valid } = normalizePhone(phone);
  return valid ? normalized : "";
}

function toDNCFormat(phone) {
  const { e164, valid } = normalizePhone(phone);
  return valid ? e164 : "";
}

function toE164(phone) {
  const { e164, valid } = normalizePhone(phone);
  return valid ? e164 : "";
}

function toNational10(phone) {
  const { national, valid } = normalizePhone(phone);
  return valid ? national : "";
}

module.exports = {
  normalizePhone,
  toStorageFormat,
  toDNCFormat,
  toE164,
  toNational10,
};