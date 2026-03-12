const Job = require('../models/Job');
const File = require('../models/File');
const jobService = require('../services/jobService');

const getDashboard = async (req, res) => {
  try {
    const latestJob = await jobService.getLatestJob();
    const recentFiles = await File.find().sort({ createdAt: -1 }).limit(10).lean();

    res.json({
  job: latestJob || {},
  files: recentFiles || []
});
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getDashboard };