const Job = require('../models/Job');

class JobService {
  async createJob(runTime, timezone) {
    const job = new Job({ runTime, timezone });
    await job.save();
    return job;
  }

  async startJob(jobId) {
    await Job.findByIdAndUpdate(jobId, {
      lastRunStatus: 'Running',
      lastRunAt: new Date()
    });
  }

  async updateJobStats(jobId, stats) {
    await Job.findByIdAndUpdate(jobId, {
      lastRunStatus: 'Success',
      totalFetched: stats.totalFetched,
      totalUniqueAfterDedup: stats.totalUniqueAfterDedup,
      totalAfterDNCRemoval: stats.totalAfterDNCRemoval,
      totalSaved: stats.totalSaved,
      perCampaignStats: stats.perCampaignStats
    });
  }

  async failJob(jobId, error) {
    await Job.findByIdAndUpdate(jobId, {
      lastRunStatus: 'Failed'
    });
    // Optionally log error details
  }

  async getLatestJob() {
    return Job.findOne().sort({ createdAt: -1 }).lean();
  }
}

module.exports = new JobService();