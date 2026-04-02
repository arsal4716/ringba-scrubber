"use strict";

const fs = require("fs").promises;
const path = require("path");
const { toStorageFormat } = require("./phoneNormalizer");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

const writeNumbersToFile = async (fileName, numbers) => {
  const dir = path.join(__dirname, "../uploads/generated");
  await ensureDir(dir);

  const filePath = path.join(dir, fileName);

  const cleaned = [...new Set((Array.isArray(numbers) ? numbers : [])
    .map(toStorageFormat)
    .filter(Boolean))];

  const content = cleaned.join("\n") + "\n";
  const tmpPath = `${filePath}.tmp-${Date.now()}`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);

  return filePath;
};

module.exports = { writeNumbersToFile };