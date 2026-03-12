const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const XLSX = require('xlsx');
const csv = require('csv-parser');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);
const DNC = require('../models/DNC');
const logger = require('../utils/logger');

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
    if (ext === '.csv' || ext === '.xlsx') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and XLSX files are allowed'));
    }
  }
}).single('dncFile');

const parseCSV = async (filePath) => {
  const numbers = [];
  await pipeline(
    fs.createReadStream(filePath),
    csv(),
    stream => {
      stream.on('data', (data) => {
        const phone = Object.values(data)[0]?.toString().trim();
        if (phone) numbers.push(phone);
      });
    }
  );
  return numbers;
};

const parseXLSX = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  return rows.slice(1).map(row => row[0]?.toString().trim()).filter(Boolean);
};

const normalizePhone = (phone) => {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = '1' + digits;
  if (digits.length === 11 && digits[0] === '1') digits = '+' + digits;
  else digits = '+' + digits; 
  return digits;
};

const processDNCFile = async (filePath, fileExt) => {
  let numbers = [];
  if (fileExt === '.csv') {
    numbers = await parseCSV(filePath);
  } else if (fileExt === '.xlsx') {
    numbers = parseXLSX(filePath);
  }
  const normalized = numbers.map(normalizePhone);
  const unique = [...new Set(normalized)];
  const bulkOps = unique.map(phone => ({
    updateOne: {
      filter: { phoneNumber: phone },
      update: { $setOnInsert: { phoneNumber: phone, uploadedAt: new Date() } },
      upsert: true
    }
  }));

  const result = await DNC.bulkWrite(bulkOps, { ordered: false });
  return {
    total: numbers.length,
    unique: unique.length,
    inserted: result.upsertedCount || 0,
    duplicatesIgnored: unique.length - (result.upsertedCount || 0)
  };
};

module.exports = { upload, processDNCFile };