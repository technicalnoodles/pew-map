const fs = require('fs');
const readline = require('readline');
const net = require('net');
const logger = require('./logger')('PaloAltoThreatProcessor');
const { loadHomeLocation, createGeoCache, isPrivateIP } = require('./geo-utils');
const { isIgnoredDestination } = require('./ignored-destinations');

const SEVERITY_MAP = {
  critical: { color: '#FF0000', level: 'critical' },
  high: { color: '#FF3300', level: 'high' },
  medium: { color: '#FF9900', level: 'medium' },
  low: { color: '#FFCC00', level: 'low' },
  informational: { color: '#FFEE00', level: 'info' },
  info: { color: '#FFEE00', level: 'info' }
};

const UDP_APPLICATIONS = new Set([
  'dns-base',
  'dtls',
  'quic',
  'stun',
  'unknown-udp'
]);

const TCP_APPLICATIONS = new Set([
  'dns-over-https',
  'ssh',
  'ssl',
  'web-browsing'
]);

const REQUIRED_COLUMNS = ['Source Address', 'Destination Address', 'Severity'];
const REPLAY_YIELD_EVERY_ROWS = 250;
const IGNORED_THREAT_CATEGORIES = new Set(['info-leak', 'unknown']);
const INFORMATIONAL_SEVERITIES = new Set(['informational', 'info']);

function isIgnoredInformationalThreatCategory(severity, category) {
  return INFORMATIONAL_SEVERITIES.has((severity || '').trim().toLowerCase()) &&
    IGNORED_THREAT_CATEGORIES.has((category || '').trim().toLowerCase());
}

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }

  fields.push(field);
  return fields;
}

function parseTimestamp(value) {
  if (!value) return Date.now();

  const normalized = value.trim()
    .replace(/\s+UTC$/i, 'Z')
    .replace(' ', 'T');
  const timestamp = Date.parse(normalized);

  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function applicationProtocol(application) {
  const normalized = (application || '').toLowerCase();
  if (UDP_APPLICATIONS.has(normalized) || normalized.includes('udp')) return 17;
  if (TCP_APPLICATIONS.has(normalized) || normalized.includes('tcp')) return 6;
  return 0;
}

function csvRow(headers, line) {
  const fields = parseCsvLine(line);
  if (fields.length !== headers.length) return null;

  return Object.fromEntries(headers.map((header, index) => [
    header,
    fields[index].trim()
  ]));
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

class PaloAltoThreatProcessor {
  constructor(homeLocation = null) {
    this.isRunning = false;
    this.homeLocation = homeLocation || loadHomeLocation(logger);
    this.geoLookup = createGeoCache().lookup;
    this.replayId = 0;
    this.readStream = null;
    this.lineReader = null;
  }

  getThreatColor(severity) {
    return SEVERITY_MAP[(severity || '').toLowerCase()] || {
      color: '#FF006E',
      level: 'unknown'
    };
  }

  geoFor(ip) {
    const geo = this.geoLookup(ip);
    if (geo || !isPrivateIP(ip) || !this.homeLocation) return geo;

    return {
      country: this.homeLocation.country,
      region: this.homeLocation.region,
      city: this.homeLocation.city,
      ll: [this.homeLocation.coordinates[1], this.homeLocation.coordinates[0]]
    };
  }

  processRow(row, callback) {
    const sourceIp = row['Source Address']?.trim();
    const destinationIp = row['Destination Address']?.trim();

    if (!sourceIp || !destinationIp || !net.isIP(sourceIp) || !net.isIP(destinationIp)) {
      return;
    }

    if (isIgnoredDestination(destinationIp)) return;

    if (isIgnoredInformationalThreatCategory(row.Severity, row['Threat Category'])) return;

    if (isPrivateIP(sourceIp) && isPrivateIP(destinationIp)) return;

    const sourceGeo = this.geoFor(sourceIp);
    const destinationGeo = this.geoFor(destinationIp);
    if (!sourceGeo || !destinationGeo) return;

    const threat = this.getThreatColor(row.Severity);
    const connection = {
      type: 'connection',
      mode: 'palo-alto',
      logSource: 'Palo Alto NGFW',
      timestamp: parseTimestamp(row['Time Generated']),
      source: {
        ip: sourceIp,
        country: sourceGeo.country || 'Unknown',
        region: sourceGeo.region || '',
        city: sourceGeo.city || 'Unknown',
        coordinates: [sourceGeo.ll[1], sourceGeo.ll[0]]
      },
      destination: {
        ip: destinationIp,
        country: destinationGeo.country || 'Unknown',
        region: destinationGeo.region || '',
        city: destinationGeo.city || 'Unknown',
        coordinates: [destinationGeo.ll[1], destinationGeo.ll[0]]
      },
      protocol: applicationProtocol(row.Application),
      threatColor: threat.color,
      threatLevel: threat.level,
      threatInfo: row['Threat Name Firewall'] || row['Threat Category'] || '',
      classification: row.Subtype || '',
      reputationCategory: row['Threat Category'] || null,
      ruleAction: row.Action || '',
      application: row.Application || '',
      directionOfAttack: row['Direction Of Attack'] || '',
      destinationPort: row['Destination Port'] || null,
      rule: row.Rule || ''
    };

    callback(connection);
  }

  startFromFile(filePath, callback) {
    this.stop();

    if (!fs.existsSync(filePath)) {
      throw new Error(`Palo Alto Threat CSV file not found: ${filePath}`);
    }

    this.isRunning = true;
    const replayId = ++this.replayId;
    this.replayFile(filePath, callback, replayId).catch((error) => {
      if (replayId === this.replayId) {
        this.isRunning = false;
        logger.error(`Failed to replay Palo Alto Threat CSV: ${error.message}`);
      }
    });
  }

  async replayFile(filePath, callback, replayId) {
    while (this.isActive(replayId)) {
      let headers = null;
      let rowsRead = 0;
      const input = fs.createReadStream(filePath, { encoding: 'utf-8' });
      const lineReader = readline.createInterface({
        input,
        crlfDelay: Infinity
      });

      this.readStream = input;
      this.lineReader = lineReader;

      try {
        for await (const line of lineReader) {
          if (!this.isActive(replayId)) break;

          if (!headers) {
            headers = parseCsvLine(line).map((header) => header
              .replace(/^\uFEFF/, '')
              .trim());
            const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
            if (missingColumns.length > 0) {
              throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
            }
            continue;
          }

          if (!line.trim()) continue;

          const row = csvRow(headers, line);
          if (!row) continue;

          rowsRead++;
          this.processRow(row, callback);

          if (rowsRead % REPLAY_YIELD_EVERY_ROWS === 0 && this.isActive(replayId)) {
            await yieldToEventLoop();
          }
        }
      } finally {
        lineReader.close();
        input.destroy();
        if (this.lineReader === lineReader) this.lineReader = null;
        if (this.readStream === input) this.readStream = null;
      }

      if (this.isActive(replayId)) {
        logger.info(`Replayed ${rowsRead} Palo Alto Threat CSV rows; restarting file`);
        await yieldToEventLoop();
      }
    }
  }

  isActive(replayId) {
    return this.isRunning && replayId === this.replayId;
  }

  stop() {
    this.isRunning = false;
    this.replayId++;

    if (this.lineReader) {
      this.lineReader.close();
      this.lineReader = null;
    }

    if (this.readStream) {
      this.readStream.destroy();
      this.readStream = null;
    }
  }
}

module.exports = { PaloAltoThreatProcessor, parseCsvLine };
