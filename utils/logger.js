const info = (...args) => console.log(new Date().toISOString(), '[INFO]', ...args);
const error = (...args) => console.error(new Date().toISOString(), '[ERROR]', ...args);

module.exports = { info, error };