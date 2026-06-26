const multer = require('multer');
const path = require('path');
const fs = require('fs'); // need createReadStream (not fs.promises)
const XLSX = require('xlsx');
const csv = require('csv-parser');
const DNC = require('../models/DNC');
const logger = require('../utils/logger');
const { toDNCFormat } = require('../utils/phoneNormalizer');

// Configure multer for DNC file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/dnc/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV, XLSX, and XLS files are allowed'));
    }
  }
}).single('dncFile');

// Read the first column of a CSV as raw strings (header included; the
// header row is dropped later because it won't normalize to a phone).
const parseCSV = (filePath) =>
  new Promise((resolve, reject) => {
    const numbers = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        const v = Object.values(row)[0];
        if (v !== undefined && v !== null && String(v).trim()) {
          numbers.push(String(v).trim());
        }
      })
      .on('end', () => resolve(numbers))
      .on('error', reject);
  });

// Read the first column of the first sheet. Numeric cells are coerced to
// full integer strings so a value like 19454253689 never comes through in
// scientific notation.
const parseXLSX = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  const out = [];
  for (const row of rows) {
    const cell = row && row[0];
    if (cell === undefined || cell === null || cell === '') continue;
    out.push(typeof cell === 'number' ? cell.toFixed(0) : String(cell).trim());
  }
  return out;
};

const processDNCFile = async (filePath, fileExt) => {
  let rawNumbers = [];
  if (fileExt === '.csv') {
    rawNumbers = await parseCSV(filePath);
  } else if (fileExt === '.xlsx' || fileExt === '.xls') {
    rawNumbers = parseXLSX(filePath);
  } else {
    throw new Error(`Unsupported file type: ${fileExt}`);
  }

  // Normalize to E.164 (+1XXXXXXXXXX) — same format the scrubber checks
  // against. Invalid rows (including the header) drop out here.
  const formatted = rawNumbers.map(toDNCFormat).filter(Boolean);
  const unique = [...new Set(formatted)];

  // No valid numbers — return cleanly instead of calling bulkWrite([]),
  // which would throw "Invalid BulkOperation, Batch cannot be empty".
  if (!unique.length) {
    return {
      total: rawNumbers.length,
      unique: 0,
      inserted: 0,
      duplicatesIgnored: 0,
      invalid: rawNumbers.length,
    };
  }

  const bulkOps = unique.map((phone) => ({
    updateOne: {
      filter: { phoneNumber: phone },
      update: { $setOnInsert: { phoneNumber: phone, uploadedAt: new Date() } },
      upsert: true,
    },
  }));

  const result = await DNC.bulkWrite(bulkOps, { ordered: false });
  const inserted = result.upsertedCount || 0;

  return {
    total: rawNumbers.length,
    unique: unique.length,
    inserted,
    duplicatesIgnored: unique.length - inserted,
    invalid: rawNumbers.length - formatted.length,
  };
};

module.exports = { upload, processDNCFile };