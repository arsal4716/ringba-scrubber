"use strict";

const cron = require("node-cron");
const fileService = require("../services/fileService");
const logger = require("../utils/logger");

/**
 * Start auto-delete cron for generated files.
 * Default: daily at 01:00 (timezone aware).
 *
 * @param {{timezone?: string, daysToKeep?: number, cronExpr?: string}} opts
 * @returns {import("node-cron").ScheduledTask}
 */
function startAutoDeleteCron(opts = {}) {
  const timezone = opts.timezone || process.env.TZ || "Asia/Karachi";
  const daysToKeep = Number(opts.daysToKeep || process.env.FILE_RETENTION_DAYS || 7);

  // default: 1:00 AM daily
  const cronExpr = opts.cronExpr || process.env.AUTO_DELETE_CRON || "0 1 * * *";

  const task = cron.schedule(
    cronExpr,
    async () => {
      try {
        logger.info(`Running auto-delete for old files (keep ${daysToKeep} days)`);
        await fileService.deleteOldFiles(daysToKeep);
        logger.info("Auto-delete completed");
      } catch (err) {
        logger.error(`Auto-delete failed: ${err?.message || err}`);
      }
    },
    { timezone, scheduled: true }
  );

  logger.info(`Auto-delete cron scheduled: "${cronExpr}" timezone=${timezone}`);
  return task;
}

module.exports = { startAutoDeleteCron };