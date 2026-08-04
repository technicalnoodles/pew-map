const assert = require('node:assert/strict');
const test = require('node:test');

const { isIgnoredDestination } = require('../lib/ignored-destinations');

test('returns true for ignored destination IPs', () => {
  assert.equal(isIgnoredDestination('172.16.16.16'), true);
  assert.equal(isIgnoredDestination('172.16.16.17'), true);
});

test('returns false for non-ignored destination IPs', () => {
  assert.equal(isIgnoredDestination('8.8.8.8'), false);
  assert.equal(isIgnoredDestination('192.168.1.1'), false);
  assert.equal(isIgnoredDestination('10.0.0.1'), false);
});

test('returns false for null, undefined, or empty IPs', () => {
  assert.equal(isIgnoredDestination(null), false);
  assert.equal(isIgnoredDestination(undefined), false);
  assert.equal(isIgnoredDestination(''), false);
});
