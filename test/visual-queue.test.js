const assert = require('node:assert/strict');
const test = require('node:test');
let enqueueVisuals;
test.before(async () => { ({ enqueueVisuals } = await import('../src/visual-queue.mjs')); });

test('keeps sampled connections in arrival order and bounds the backlog', () => {
  const queue = enqueueVisuals([{ id: 1 }], [{ id: 4 }, { id: 2 }, { id: 3 }], 3);
  assert.deepEqual(queue.map(item => item.id), [2, 3, 4]);
});
