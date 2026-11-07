const assert = require('node:assert/strict');
const test = require('node:test');

const SyslogProcessor = require('../lib/syslog-processor');

test('identifies local responder IP addresses', () => {
  const processor = new SyslogProcessor({ country: 'US', region: 'DC', city: 'Washington', coordinates: [-77.0365, 38.8977] });
  assert.equal(processor.isLocalResponder('208.67.222.222'), true);
  assert.equal(processor.isLocalResponder('208.67.220.220'), true);
  assert.equal(processor.isLocalResponder('2620:119:35::35'), true);
  assert.equal(processor.isLocalResponder('2620:119:53::53'), true);
  assert.equal(processor.isLocalResponder('8.8.8.8'), false);
});

test('parses valid syslog JSON entries for IPS and Security Intelligence events', () => {
  const processor = new SyslogProcessor({ country: 'US', region: 'DC', city: 'Washington', coordinates: [-77.0365, 38.8977] });
  const validIps = 'CEF:0|Cisco|FTD|1.0|430001|IPS Event|1| {"InitiatorIP": "1.2.3.4", "ResponderIP": "5.6.7.8"}';
  const validSi = 'CEF:0|Cisco|FTD|1.0|430002|Security Intelligence|1| {"InitiatorIP": "1.2.3.4", "ResponderIP": "5.6.7.8"}';

  assert.deepEqual(processor.parseSyslogEntry(validIps), { InitiatorIP: '1.2.3.4', ResponderIP: '5.6.7.8' });
  assert.deepEqual(processor.parseSyslogEntry(validSi), { InitiatorIP: '1.2.3.4', ResponderIP: '5.6.7.8' });
});

test('returns null for syslog entries without target event IDs or invalid JSON', () => {
  const processor = new SyslogProcessor({ country: 'US', region: 'DC', city: 'Washington', coordinates: [-77.0365, 38.8977] });
  const otherEvent = 'CEF:0|Cisco|FTD|1.0|106023|Deny udp src|1| {"InitiatorIP": "1.2.3.4"}';
  const malformedJson = 'CEF:0|Cisco|FTD|1.0|430001|IPS Event|1| {"InitiatorIP": "1.2.3.4"';

  assert.equal(processor.parseSyslogEntry(otherEvent), null);
  assert.equal(processor.parseSyslogEntry(malformedJson), null);
});

test('maps threat colors and severity levels from reputation categories and priorities', () => {
  const processor = new SyslogProcessor({ country: 'US', region: 'DC', city: 'Washington', coordinates: [-77.0365, 38.8977] });

  assert.deepEqual(processor.colorFromReputation('malware-botnet'), { color: '#FF0000', level: 'critical' });
  assert.deepEqual(processor.colorFromReputation('botnet-cnc'), { color: '#FF3300', level: 'high' });
  assert.deepEqual(processor.colorFromReputation('phishing'), { color: '#FF6600', level: 'medium' });
  assert.deepEqual(processor.colorFromReputation('tor-proxy'), { color: '#FF9900', level: 'low' });

  assert.deepEqual(processor.colorFromPriority(1), { color: '#FF0000', level: 'critical' });
  assert.deepEqual(processor.colorFromPriority(5), { color: '#FFEE00', level: 'info' });

  assert.deepEqual(
    processor.getThreatColor({ IP_ReputationSI_Category: 'malware', PriorityID: 5 }),
    { color: '#FF0000', level: 'critical' }
  );
  assert.deepEqual(
    processor.getThreatColor({ PriorityID: 2 }),
    { color: '#FF5500', level: 'high' }
  );
});

test('parses JSON connection events by message_id without matching unrelated fields', () => {
  const processor = new SyslogProcessor({ country: 'AU', city: 'Melbourne', coordinates: [145, -38] });
  const event = { rec_type: 'FTD', message_id: '430002', InitiatorIP: '10.1.2.3', ResponderIP: '8.8.8.8', Protocol: 'udp', EventPriority: 'Low', AC_RuleAction: 'Block' };
  assert.deepEqual(processor.parseSyslogEntry(JSON.stringify(event)), event);
  assert.equal(processor.parseSyslogEntry(JSON.stringify({ ...event, message_id: '106023', ConnectionID: 430002 })), null);
});

test('normalizes a live JSON connection event and keeps private-to-OpenDNS direction', () => {
  const processor = new SyslogProcessor({ country: 'AU', city: 'Melbourne', coordinates: [145, -38] });
  processor.geoLookup = ip => ip === '208.67.222.222' ? { country: 'US', city: 'San Francisco', ll: [37, -122] } : null;
  const event = { message_id: '430002', InitiatorIP: '10.1.2.3', ResponderIP: '208.67.222.222', Protocol: 'udp', EventPriority: 'Low', AC_RuleAction: 'Allow' };
  let connection;
  processor.handleRawSyslog(JSON.stringify(event), result => { connection = result; });
  assert.equal(connection.source.ip, '10.1.2.3');
  assert.equal(connection.destination.ip, '208.67.222.222');
  assert.equal(connection.protocol, 17);
  assert.equal(connection.ruleAction, 'Allow');
  assert.equal(connection.threatLevel, 'low');
});

test('ignores unrelated non-JSON syslog messages without logging parse errors', t => {
  const processor = new SyslogProcessor({ country: 'AU', city: 'Melbourne', coordinates: [145, -38] });
  const error = t.mock.method(console, 'error', () => {});
  assert.equal(processor.parseSyslogEntry('%FTD-6-106023: denied {source=example} {destination=example}'), null);
  assert.equal(error.mock.callCount(), 0);
});
