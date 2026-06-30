const { upload, processDNCFile } = require('../services/dncService');
const DNC = require('../models/DNC');
const Call = require('../models/Call');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const { toStorageFormat } = require('../utils/phoneNormalizer');

// GET /api/dnc/count — total numbers currently in the DNC table.
const getDNCCount = async (req, res) => {
  try {
    const count = await DNC.estimatedDocumentCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get DNC count' });
  }
};

// Stream a newline txt of 11-digit numbers as a download.
function sendNumbersTxt(res, fileName, numbers) {
  const unique = [...new Set(numbers.map(toStorageFormat).filter(Boolean))];
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(unique.join('\n') + '\n');
}

// GET /api/dnc/download — all DNC numbers.
const downloadDNC = async (req, res) => {
  try {
    const dnc = await DNC.find().distinct('phoneNumber').lean();
    sendNumbersTxt(res, 'DNC_numbers.txt', dnc);
  } catch (err) {
    logger.error(`DNC download failed: ${err?.message || err}`);
    res.status(500).json({ error: 'Download failed' });
  }
};

// GET /api/dnc/download/:product — DNC numbers + all numbers for a product
// (ACA or SSDI) currently in the Call DB, combined and de-duplicated.
const downloadDNCWithProduct = async (req, res) => {
  try {
    const product = String(req.params.product || '').toUpperCase();
    if (!['ACA', 'SSDI'].includes(product)) {
      return res.status(400).json({ error: 'product must be ACA or SSDI' });
    }
    const [dnc, calls] = await Promise.all([
      DNC.find().distinct('phoneNumber').lean(),
      Call.find({ campaignName: product }).distinct('phoneNumber').lean(),
    ]);
    sendNumbersTxt(res, `DNC_plus_${product}.txt`, [...dnc, ...calls]);
  } catch (err) {
    logger.error(`DNC+product download failed: ${err?.message || err}`);
    res.status(500).json({ error: 'Download failed' });
  }
};

const uploadDNC = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const filePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase();
      const stats = await processDNCFile(filePath, fileExt);

      // Clean up uploaded file
      await fs.unlink(filePath);

      res.json({
        message: 'DNC file processed',
        totalNumbers: stats.total,
        uniqueNumbers: stats.unique,
        inserted: stats.inserted,
        duplicatesIgnored: stats.duplicatesIgnored
      });
    } catch (err) {
      logger.error(`DNC processing failed: ${err?.message || err}`);
      // Best-effort cleanup of the uploaded temp file.
      fs.unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: `Failed to process DNC file: ${err?.message || 'unknown error'}` });
    }
  });
};

module.exports = { uploadDNC, getDNCCount, downloadDNC, downloadDNCWithProduct };