const moment = require('moment-timezone');

const getTodayInTimezone = (timezone) => {
  return moment.tz(timezone).startOf('day');
};

const getDateRange = (timezone, type) => {
  const today = getTodayInTimezone(timezone);
  let startDate, endDate;
  if (type === '1year') {
    startDate = today.clone().subtract(365, 'days').toDate();
    endDate = today.clone().endOf('day').toDate();
  } else { // 45days
    startDate = today.clone().subtract(45, 'days').toDate();
    endDate = today.clone().endOf('day').toDate();
  }
  return { startDate, endDate };
};

module.exports = { getTodayInTimezone, getDateRange };