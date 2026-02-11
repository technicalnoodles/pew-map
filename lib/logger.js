const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'pew-map.log');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL = (process.env.LOG_LEVEL || 'debug').toLowerCase();

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function formatTimestamp() {
  return new Date().toISOString();
}

function writeToFile(level, tag, message, extra) {
  if (LOG_LEVELS[level] == null || LOG_LEVELS[level] < (LOG_LEVELS[MIN_LEVEL] || 0)) {
    return;
  }

  const parts = [`[${formatTimestamp()}]`, `[${level.toUpperCase()}]`];
  if (tag) parts.push(`[${tag}]`);
  parts.push(message);
  if (extra !== undefined) {
    parts.push(typeof extra === 'string' ? extra : JSON.stringify(extra));
  }

  const line = parts.join(' ') + '\n';
  fs.appendFileSync(LOG_FILE, line);
}

function createLogger(tag) {
  return {
    debug(message, extra) {
      writeToFile('debug', tag, message, extra);
      if (extra !== undefined) {
        console.log(`[${tag}]`, message, extra);
      } else {
        console.log(`[${tag}]`, message);
      }
    },
    info(message, extra) {
      writeToFile('info', tag, message, extra);
      if (extra !== undefined) {
        console.log(`[${tag}]`, message, extra);
      } else {
        console.log(`[${tag}]`, message);
      }
    },
    warn(message, extra) {
      writeToFile('warn', tag, message, extra);
      if (extra !== undefined) {
        console.warn(`[${tag}]`, message, extra);
      } else {
        console.warn(`[${tag}]`, message);
      }
    },
    error(message, extra) {
      writeToFile('error', tag, message, extra);
      if (extra !== undefined) {
        console.error(`[${tag}]`, message, extra);
      } else {
        console.error(`[${tag}]`, message);
      }
    }
  };
}

module.exports = createLogger;
