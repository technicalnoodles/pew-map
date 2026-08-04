const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveCaptureSource,
  startCaptureSource
} = require('../lib/capture-source');

test('selects a Palo Alto Threat CSV replay source', () => {
  const filePath = '/exports/firewall_threat_2026-08-02.csv';

  assert.deepEqual(resolveCaptureSource({ paloAltoFile: filePath }), {
    type: 'palo-alto-file',
    filePath
  });
});

test('keeps the existing FTD and PCAP source choices intact', () => {
  assert.deepEqual(resolveCaptureSource({ syslogLive: true, syslogPort: 5514 }), {
    type: 'syslog-live',
    port: 5514
  });
  assert.deepEqual(resolveCaptureSource({ syslogFile: '/exports/ftd.json' }), {
    type: 'syslog-file',
    filePath: '/exports/ftd.json'
  });
  assert.deepEqual(resolveCaptureSource({ pcapFile: '/captures/sample.pcap' }), {
    type: 'pcap-file',
    filePath: '/captures/sample.pcap'
  });
  assert.deepEqual(resolveCaptureSource({ interface: 'en0' }), {
    type: 'live-capture',
    interface: 'en0'
  });
});

test('starts the Palo Alto processor for a Palo Alto Threat CSV source', () => {
  const started = [];
  const callback = () => {};
  const processors = {
    packetProcessor: {
      startLiveCapture: () => started.push('packet-live'),
      startFromFile: () => started.push('packet-file')
    },
    syslogProcessor: {
      startLive: () => started.push('syslog-live'),
      startFromFile: () => started.push('syslog-file')
    },
    paloAltoProcessor: {
      startFromFile: (filePath, receivedCallback) => {
        started.push({ type: 'palo-alto-file', filePath, receivedCallback });
      }
    }
  };
  const source = resolveCaptureSource({ paloAltoFile: '/exports/threat.csv' });

  startCaptureSource(source, processors, callback);

  assert.deepEqual(started, [{
    type: 'palo-alto-file',
    filePath: '/exports/threat.csv',
    receivedCallback: callback
  }]);
});
