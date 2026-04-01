const DNC = require('../models/DNC');

const filterDNC = async (phoneNumbers) => {
  const dncNumbers = await DNC.find({ phoneNumber: { $in: phoneNumbers } }).distinct('phoneNumber').lean();
  const dncSet = new Set(dncNumbers);
  return phoneNumbers.filter(num => !dncSet.has(num));
};

module.exports = { filterDNC };