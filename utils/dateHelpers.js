const moment = require('moment-timezone');

const getTodayInTimezone = (timezone) => {
  return moment.tz(timezone).startOf('day');
};

const getDateRange = (timezone, type) => {
  const today = getTodayInTimezone(timezone);
  const endDate = today.clone().endOf('day').toDate();
  let startDate;

  switch (type) {
    case '1year':
      startDate = today.clone().subtract(365, 'days').toDate();
      break;
    case '6months':
      startDate = today.clone().subtract(6, 'months').toDate();
      break;
    case '90days':
      startDate = today.clone().subtract(90, 'days').toDate();
      break;
    case '30days':
      startDate = today.clone().subtract(30, 'days').toDate();
      break;
    case '45days':
    default:
      startDate = today.clone().subtract(45, 'days').toDate();
      break;
  }

  return { startDate, endDate };
};

module.exports = { getTodayInTimezone, getDateRange };