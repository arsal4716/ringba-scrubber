const Job = require('../models/Job');
const jobService = require('../services/jobService');
const { getTodayInTimezone } = require('../utils/dateHelpers');
const { scheduleFetchJob } = require('../cron/fetchCron'); 

const saveSchedule = async (req, res) => {
  try {
    const { runTime, timezone } = req.body; 
    if (!runTime || !timezone) {
      return res.status(400).json({ error: 'runTime and timezone required' });
    }
    const now = getTodayInTimezone(timezone);
    const [hours, minutes] = runTime.split(':').map(Number);
    const scheduled = now.clone().hours(hours).minutes(minutes).seconds(0);

    if (scheduled.isBefore(now)) {
      scheduled.add(1, 'day');
    }
    let job = await Job.findOne().sort({ createdAt: -1 });
    if (job) {
      job.runTime = scheduled.toDate();
      job.timezone = timezone;
      await job.save();
    } else {
      job = await jobService.createJob(scheduled.toDate(), timezone);
    }
    scheduleFetchJob(scheduled.toDate(), timezone);

    res.json({ success: true, nextRun: scheduled.toDate() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const getSchedule = async (req, res) => {
  try {
    const job = await Job.findOne().sort({ createdAt: -1 }).lean();
    res.json(job || {});
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { saveSchedule, getSchedule };