const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

test('keeps accelerated client batches bounded while preserving the event count', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const {
      addConnectionToClientBatch,
      drainClientBatch
    } = require('./lib/client-batch');
    const client = { buffer: [], totalCount: 0 };

    for (let index = 0; index < 10000; index += 1) {
      addConnectionToClientBatch(client, { id: index }, 200);
    }

    const batch = drainClientBatch(client);
    process.stdout.write(JSON.stringify({
      totalCount: batch.totalCount,
      visualCount: batch.visual.length,
      resetCount: client.totalCount,
      resetVisualCount: client.buffer.length
    }));
  `], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    totalCount: 10000,
    visualCount: 200,
    resetCount: 0,
    resetVisualCount: 0
  });
});
