const File = require('../models/File');
const path = require('path');
const fs = require('fs');
const moment = require('moment-timezone');

const TZ = process.env.APP_TIMEZONE && process.env.APP_TIMEZONE.includes('New_York')
  ? process.env.APP_TIMEZONE
  : 'America/New_York';

// GET /api/files?all=true | ?date=YYYY-MM-DD | (default: latest run only)
const getFiles = async (req, res) => {
  try {
    const { all, date } = req.query;

    if (all === 'true') {
      const files = await File.find().sort({ createdAt: -1 }).lean();
      return res.json(files);
    }

    if (date) {
      const start = moment.tz(date, 'YYYY-MM-DD', TZ).startOf('day').toDate();
      const end = moment.tz(date, 'YYYY-MM-DD', TZ).endOf('day').toDate();
      const files = await File.find({ createdAt: { $gte: start, $lte: end } })
        .sort({ createdAt: -1 })
        .lean();
      return res.json(files);
    }

    // Default: only the most recent run's files.
    const latest = await File.findOne().sort({ createdAt: -1 }).lean();
    if (!latest) return res.json([]);

    let files;
    if (latest.runId) {
      files = await File.find({ runId: latest.runId }).sort({ createdAt: -1 }).lean();
    } else {
      // Legacy files without a runId: fall back to the latest calendar day.
      const start = moment(latest.createdAt).startOf('day').toDate();
      files = await File.find({ createdAt: { $gte: start } }).sort({ createdAt: -1 }).lean();
    }
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

const downloadFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id).lean();
    if (!file) return res.status(404).json({ error: 'File not found' });

    const filePath = path.join(__dirname, '../uploads/generated', file.fileName);
    res.download(filePath, file.fileName);
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
};

const deleteFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id).lean();
    if (!file) return res.status(404).json({ error: 'File not found' });

    const filePath = path.join(__dirname, '../uploads/generated', file.fileName);
    await fs.promises.unlink(filePath).catch(() => {}); // ignore if already gone
    await File.deleteOne({ _id: req.params.id });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
};

module.exports = { getFiles, downloadFile, deleteFile };