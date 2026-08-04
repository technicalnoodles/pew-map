const IGNORED_DESTINATION_IPS = new Set([
  '172.16.16.16',
  '172.16.16.17'
]);

function isIgnoredDestination(ip) {
  return IGNORED_DESTINATION_IPS.has(ip);
}

module.exports = { isIgnoredDestination };
