const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function runWithUnavailablePcap(script) {
  const preload = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'pcap') {
        const error = new Error('Synthetic missing pcap native binding');
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      }
      return originalLoad.apply(this, arguments);
    };
  `;

  return spawnSync(process.execPath, ['-e', `${preload}\n${script}`], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOG_LEVEL: 'error',
      PORT: '0'
    },
    timeout: 2000
  });
}

function resultDetails(result) {
  return `status=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`;
}

test('loads the server without a native pcap binding', () => {
  const result = runWithUnavailablePcap(`
    const EventEmitter = require('node:events');
    const express = require('express');
    express.application.listen = function(port, callback) {
      const server = new EventEmitter();
      server.close = (done) => done && done();
      if (callback) process.nextTick(callback);
      return server;
    };
    require('./server');
    setTimeout(() => process.exit(0), 100);
  `);

  assert.equal(result.status, 0, resultDetails(result));
});

test('reports pcap unavailability when a capture mode is selected', () => {
  const result = runWithUnavailablePcap(`
    const PacketProcessor = require('./lib/packet-processor');
    const processor = new PacketProcessor({
      country: 'US',
      region: 'DC',
      city: 'Washington',
      coordinates: [-77.0365, 38.8977]
    });
    const errors = [];

    for (const startCapture of [
      () => processor.startLiveCapture('en0', () => {}),
      () => processor.startFromFile(process.execPath, () => {})
    ]) {
      try {
        startCapture();
        process.exit(1);
      } catch (error) {
        errors.push({ code: error.code, message: error.message });
      }
    }

    process.stdout.write(JSON.stringify(errors));
    process.exit(errors.every((error) => error.code === 'PCAP_UNAVAILABLE') ? 0 : 2);
  `);

  assert.equal(result.status, 0, resultDetails(result));
  assert.match(result.stdout, /Packet capture is unavailable/);
});
