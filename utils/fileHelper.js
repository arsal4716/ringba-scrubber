"use strict";

const fs = require("fs").promises;
const path = require("path");

function normalizePhone(value) {
  if (!value) return "";
  const s = String(value).trim();
  const noPlus = s.startsWith("+") ? s.slice(1) : s;
  return noPlus.replace(/[^\d]/g, "");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

const writeNumbersToFile = async (fileName, numbers) => {
  const dir = path.join(__dirname, "../uploads/generated");
  await ensureDir(dir);

  const filePath = path.join(dir, fileName);

  const cleaned = (Array.isArray(numbers) ? numbers : [])
    .map(normalizePhone)
    .filter(Boolean);

  const content = cleaned.join("\n") + "\n";
  const tmpPath = `${filePath}.tmp-${Date.now()}`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);

  return filePath;
};

module.exports = { writeNumbersToFile, normalizePhone };