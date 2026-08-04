const assert = require('node:assert/strict');
const test = require('node:test');

const createLogger = require('../lib/logger');

test('creates a logger instance with debug, info, warn, and error methods', () => {
  const logger = createLogger('TestTag');
  assert.equal(typeof logger.debug, 'function');
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.warn, 'function');
  assert.equal(typeof logger.error, 'function');
});

test('logger methods execute without error', () => {
  const logger = createLogger('TestTag');
  assert.doesNotThrow(() => {
    logger.info('Test info message', { test: true });
    logger.error('Test error message', 'extra string');
  });
});
