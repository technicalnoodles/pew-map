const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  PaloAltoThreatProcessor,
  parseCsvLine
} = require('../lib/palo-alto-processor');
const SyslogProcessor = require('../lib/syslog-processor');

test('parses quoted Palo Alto Threat CSV fields containing commas', () => {
  const fields = parseCsvLine(
    '2026-08-02 23:08:45 UTC,High,vulnerability,"Threat, with comma",41001,phishing,inside,192.168.1.20,,internet,8.8.8.8,,443,ssl,client to server,"https://example.test/path?a=1,b=2",,,,,drop,egress-rule'
  );

  assert.equal(fields[3], 'Threat, with comma');
  assert.equal(fields[15], 'https://example.test/path?a=1,b=2');
  assert.equal(fields[20], 'drop');
});

test('normalizes a Palo Alto Threat row into a map-ready threat connection', () => {
  const processor = new PaloAltoThreatProcessor({
    country: 'US',
    region: 'DC',
    city: 'Washington',
    coordinates: [-77.0365, 38.8977]
  });
  const connections = [];

  processor.processRow({
    'Time Generated': '2026-08-02 23:08:45 UTC',
    Severity: 'High',
    Subtype: 'spyware',
    'Threat Name Firewall': 'Known malicious command-and-control host',
    'Threat Category': 'botnet',
    'Source Address': '192.168.1.20',
    'Destination Address': '8.8.8.8',
    'Destination Port': '53',
    Application: 'dns-base',
    'Direction Of Attack': 'client to server',
    Action: 'drop',
    Rule: 'egress-rule'
  }, (connection) => connections.push(connection));

  assert.equal(connections.length, 1);

  const [connection] = connections;
  assert.equal(connection.mode, 'palo-alto');
  assert.equal(connection.source.ip, '192.168.1.20');
  assert.deepEqual(connection.source.coordinates, [-77.0365, 38.8977]);
  assert.equal(connection.destination.ip, '8.8.8.8');
  assert.ok(connection.destination.coordinates);
  assert.equal(connection.protocol, 17);
  assert.equal(connection.threatLevel, 'high');
  assert.equal(connection.threatColor, '#FF3300');
  assert.equal(connection.threatInfo, 'Known malicious command-and-control host');
  assert.equal(connection.classification, 'spyware');
  assert.equal(connection.reputationCategory, 'botnet');
  assert.equal(connection.ruleAction, 'drop');
  assert.equal(connection.timestamp, Date.parse('2026-08-02T23:08:45Z'));
});

test('does not emit a Palo Alto Threat row whose endpoints are both private', () => {
  const processor = new PaloAltoThreatProcessor({
    country: 'US',
    region: 'DC',
    city: 'Washington',
    coordinates: [-77.0365, 38.8977]
  });
  const connections = [];

  processor.processRow({
    'Source Address': '10.0.0.10',
    'Destination Address': '172.16.0.10',
    Severity: 'Low'
  }, (connection) => connections.push(connection));

  assert.deepEqual(connections, []);
});

test('does not emit a Palo Alto Threat row going to an excluded destination', () => {
  const processor = new PaloAltoThreatProcessor({
    country: 'US',
    region: 'DC',
    city: 'Washington',
    coordinates: [-77.0365, 38.8977]
  });
  const connections = [];

  processor.processRow({
    'Source Address': '8.8.8.8',
    'Destination Address': '172.16.16.16',
    Severity: 'High'
  }, (connection) => connections.push(connection));

  assert.deepEqual(connections, []);
});

test('filters selected Palo Alto Threat categories only when informational', () => {
  const processor = new PaloAltoThreatProcessor({
    country: 'US',
    region: 'DC',
    city: 'Washington',
    coordinates: [-77.0365, 38.8977]
  });
  const connections = [];

  for (const { category, severity } of [
    { category: 'info-leak', severity: 'Informational' },
    { category: 'unknown', severity: 'Informational' },
    { category: 'protocol-anomaly', severity: 'Informational' },
    { category: 'unknown', severity: 'Low' },
    { category: 'info-leak', severity: 'Medium' }
  ]) {
    processor.processRow({
      'Source Address': '192.168.1.20',
      'Destination Address': '8.8.8.8',
      Severity: severity,
      'Threat Category': category
    }, (connection) => connections.push(connection));
  }

  assert.deepEqual(
    connections.map((connection) => `${connection.threatLevel}:${connection.reputationCategory}`),
    ['info:protocol-anomaly', 'low:unknown', 'medium:info-leak']
  );
});

test('does not emit an FTD syslog event going to an excluded destination', () => {
  const processor = new SyslogProcessor({
    country: 'US',
    region: 'DC',
    city: 'Washington',
    coordinates: [-77.0365, 38.8977]
  });
  const connections = [];

  processor.processEntry({
    InitiatorIP: '8.8.8.8',
    ResponderIP: '172.16.16.17',
    PriorityID: 1
  }, (connection) => connections.push(connection));

  assert.deepEqual(connections, []);
});

test('replays a Palo Alto Threat CSV file without loading it into memory', async (t) => {
  const processor = new PaloAltoThreatProcessor({
    country: 'US',
    region: 'DC',
    city: 'Washington',
    coordinates: [-77.0365, 38.8977]
  });
  t.after(() => processor.stop());

  const connection = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      processor.stop();
      reject(new Error('Timed out waiting for Palo Alto CSV replay'));
    }, 1000);

    try {
      processor.startFromFile(
        path.join(__dirname, 'fixtures', 'palo-alto-threat.csv'),
        (entry) => {
          clearTimeout(timeout);
          processor.stop();
          resolve(entry);
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });

  assert.equal(connection.threatInfo, 'Threat, with comma');
  assert.equal(connection.ruleAction, 'drop');
  assert.equal(connection.destination.ip, '8.8.8.8');
});

test('replays Palo Alto Threat CSV rows without an event-time delay', async (t) => {
  const processor = new PaloAltoThreatProcessor({
    country: 'US',
    region: 'DC',
    city: 'Washington',
    coordinates: [-77.0365, 38.8977]
  });
  t.after(() => processor.stop());

  const elapsedMilliseconds = await new Promise((resolve, reject) => {
    let received = 0;
    const timeout = setTimeout(() => {
      processor.stop();
      reject(new Error('Timed out waiting for two Palo Alto CSV rows'));
    }, 1000);
    const startedAt = Date.now();

    try {
      processor.startFromFile(
        path.join(__dirname, 'fixtures', 'palo-alto-threat.csv'),
        () => {
          received += 1;
          if (received === 2) {
            clearTimeout(timeout);
            processor.stop();
            resolve(Date.now() - startedAt);
          }
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });

  assert.ok(
    elapsedMilliseconds < 70,
    `Expected two rows in under 70ms, received them in ${elapsedMilliseconds}ms`
  );
});
