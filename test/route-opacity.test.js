const assert = require('node:assert/strict');
const test = require('node:test');
let routeOpacity;
test.before(async () => { ({ routeOpacity } = await import('../src/route-opacity.mjs')); });

test('fades routes in and out, bounded between zero and one', () => {
  assert.equal(routeOpacity(0, 0, 2000), 0);
  assert.equal(routeOpacity(90, 0, 2000), 0.5);
  assert.equal(routeOpacity(1000, 0, 2000), 1);
  assert.equal(routeOpacity(1840, 0, 2000), 0.5);
  assert.equal(routeOpacity(2100, 0, 2000), 0);
});

test('reviving a fading route continues smoothly from its current opacity', async () => {
  const { extendRoute } = await import('../src/route-opacity.mjs');
  const route = { createdAt: 0, expiresAt: 2000, startOpacity: 0 };
  const before = routeOpacity(1900, route.createdAt, route.expiresAt, 180, 320, route.startOpacity);
  extendRoute(route, 1900, 2000);
  assert.equal(routeOpacity(1900, route.createdAt, route.expiresAt, 180, 320, route.startOpacity), before);
  assert.ok(routeOpacity(1990, route.createdAt, route.expiresAt, 180, 320, route.startOpacity) > before);
});
