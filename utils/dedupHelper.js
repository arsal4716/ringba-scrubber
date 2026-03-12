const deduplicateNumbers = (numbersArray) => {
  const seen = new Set();
  return numbersArray.filter(num => {
    if (seen.has(num)) return false;
    seen.add(num);
    return true;
  });
};

module.exports = { deduplicateNumbers };