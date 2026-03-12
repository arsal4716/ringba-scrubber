const File = require('../models/File');
const path = require('path');
const fs = require('fs');

const getFiles = async (req, res) => {
  try {
    const files = await File.find().sort({ createdAt: -1 }).lean();
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
    await fs.promises.unlink(filePath);
    await File.deleteOne({ _id: req.params.id });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
};

module.exports = { getFiles, downloadFile, deleteFile };