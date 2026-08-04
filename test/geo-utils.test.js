const assert = require('node:assert/strict');
const test = require('node:test');

const { isPrivateIP, loadHomeLocation } = require('../lib/geo-utils');

test('identifies IPv4 and IPv6 private/local IP addresses', () => {
  assert.equal(isPrivateIP('10.0.0.1'), true);
  assert.equal(isPrivateIP('10.255.255.255'), true);
  assert.equal(isPrivateIP('127.0.0.1'), true);
  assert.equal(isPrivateIP('172.16.0.1'), true);
  assert.equal(isPrivateIP('172.31.255.255'), true);
  assert.equal(isPrivateIP('192.168.0.1'), true);
  assert.equal(isPrivateIP('192.168.255.255'), true);
  assert.equal(isPrivateIP('169.254.1.1'), true);

  assert.equal(isPrivateIP('::1'), true);
  assert.equal(isPrivateIP('fe80::1'), true);
  assert.equal(isPrivateIP('fc00::1'), true);
  assert.equal(isPrivateIP('fd00::1'), true);
  assert.equal(isPrivateIP('::ffff:127.0.0.1'), true);
});

test('identifies public IP addresses as non-private', () => {
  assert.equal(isPrivateIP('8.8.8.8'), false);
  assert.equal(isPrivateIP('172.15.0.1'), false);
  assert.equal(isPrivateIP('172.32.0.1'), false);
  assert.equal(isPrivateIP('192.169.0.1'), false);
  assert.equal(isPrivateIP('1.1.1.1'), false);
  assert.equal(isPrivateIP('2001:4860:4860::8888'), false);
});

test('returns false for null, undefined, or empty IP input', () => {
  assert.equal(isPrivateIP(null), false);
  assert.equal(isPrivateIP(undefined), false);
  assert.equal(isPrivateIP(''), false);
});

test('loads home location from environment variables when defined', () => {
  process.env.HOME_LATITUDE = '38.8977';
  process.env.HOME_LONGITUDE = '-77.0365';
  process.env.HOME_COUNTRY = 'US';
  process.env.HOME_STATE = 'DC';
  process.env.HOME_CITY = 'Washington';

  const home = loadHomeLocation();
  assert.deepEqual(home, {
    country: 'US',
    region: 'DC',
    city: 'Washington',
    coordinates: [-77.0365, 38.8977]
  });

  delete process.env.HOME_LATITUDE;
  delete process.env.HOME_LONGITUDE;
  delete process.env.HOME_COUNTRY;
  delete process.env.HOME_STATE;
  delete process.env.HOME_CITY;
});
