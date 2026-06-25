const Job = require('../models/Job');
const File = require('../models/File');
const DNC = require('../models/DNC');
const jobService = require('../services/jobService');

const getDashboard = async (req, res) => {
  try {
    const [latestJob, recentFiles, dncCount] = await Promise.all([
      jobService.getLatestJob(),
      File.find().sort({ createdAt: -1 }).limit(10).lean(),
      DNC.estimatedDocumentCount(),
    ]);

    res.json({
      job: latestJob || {},
      files: recentFiles || [],
      dncCount: dncCount || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getDashboard };