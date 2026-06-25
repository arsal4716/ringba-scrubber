const { upload, processDNCFile } = require('../services/dncService');
const DNC = require('../models/DNC');
const path = require('path');
const fs = require('fs').promises;

// GET /api/dnc/count — total numbers currently in the DNC table.
const getDNCCount = async (req, res) => {
  try {
    const count = await DNC.estimatedDocumentCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get DNC count' });
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
      console.error(err);
      res.status(500).json({ error: 'Failed to process DNC file' });
    }
  });
};

module.exports = { uploadDNC, getDNCCount };