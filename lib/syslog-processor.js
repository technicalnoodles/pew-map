const fs = require('fs');
const readline = require('readline');
const dgram = require('dgram');
const net = require('net');
const logger = require('./logger')('SyslogProcessor');
const { loadHomeLocation, createGeoCache, isPrivateIP } = require('./geo-utils');

const PROTOCOL_MAP = { tcp: 6, udp: 17, icmp: 1 };

const LOCAL_RESPONDER_IPS = new Set([
  '208.67.222.222',
  '208.67.220.220',
  '2620:119:35::35',
  '2620:119:53::53'
]);

class SyslogProcessor {
  constructor(homeLocation = null) {
    this.isRunning = false;
    this.homeLocation = homeLocation || loadHomeLocation(logger);
    this.replayTimer = null;
    this.udpServer = null;
    this.tcpServer = null;
    this.tcpSockets = new Set();
    this.geoLookup = createGeoCache().lookup;
  }

  isLocalResponder(ip) {
    return LOCAL_RESPONDER_IPS.has(ip);
  }

  parseSyslogEntry(raw) {
    // Only process IPS (430001) and Security Intelligence (430002) events
    if (!raw.includes('430001') && !raw.includes('430002')) return null;

    const jsonStart = raw.indexOf('{');
    if (jsonStart === -1) return null;

    const jsonEnd = raw.lastIndexOf('}');
    if (jsonEnd === -1 || jsonEnd <= jsonStart) return null;

    try {
      const jsonStr = raw.substring(jsonStart, jsonEnd + 1);
      return JSON.parse(jsonStr);
    } catch (err) {
      logger.error('Failed to parse syslog JSON', err.message);
      return null;
    }
  }

  getThreatColor(entry) {
    if (entry.IP_ReputationSI_Category) {
      return this.colorFromReputation(entry.IP_ReputationSI_Category);
    }
    if (entry.PriorityID != null) {
      return this.colorFromPriority(entry.PriorityID);
    }
    return { color: '#FF006E', level: 'unknown' };
  }

  colorFromReputation(category) {
    const cat = (category || '').toLowerCase();
    if (cat.includes('malware') || cat.includes('malicious')) {
      return { color: '#FF0000', level: 'critical' };
    }
    if (cat.includes('botnet') || cat.includes('cnc') || cat.includes('command')) {
      return { color: '#FF3300', level: 'high' };
    }
    if (cat.includes('phishing') || cat.includes('spam')) {
      return { color: '#FF6600', level: 'medium' };
    }
    if (cat.includes('tor') || cat.includes('open_proxy') || cat.includes('proxy')) {
      return { color: '#FF9900', level: 'low' };
    }
    return { color: '#FF0000', level: 'high' };
  }

  colorFromPriority(priorityId) {
    const map = {
      1: { color: '#FF0000', level: 'critical' },
      2: { color: '#FF5500', level: 'high' },
      3: { color: '#FF9900', level: 'medium' },
      4: { color: '#FFCC00', level: 'low' },
      5: { color: '#FFEE00', level: 'info' }
    };
    return map[priorityId] || { color: '#FF006E', level: 'unknown' };
  }

  processEntry(entry, callback) {
    if (!entry) return;

    const initiatorIP = entry.InitiatorIP;
    const responderIP = entry.ResponderIP;
    if (!initiatorIP || !responderIP) return;

    const initiatorPrivate = isPrivateIP(initiatorIP);
    const responderPrivate = isPrivateIP(responderIP);
    const responderLocal = this.isLocalResponder(responderIP);

    // Ignore internal-to-internal
    if (initiatorPrivate && responderPrivate) return;

    // Determine source/destination for the map arc
    // "source" = start of arc, "destination" = end of arc
    let srcIp, dstIp;

    if (responderLocal) {
      // Responder is local DNS — connection originates from local network
      // Arc starts at home location (responder), ends at external initiator
      srcIp = responderIP;
      dstIp = initiatorIP;
    } else if (initiatorPrivate) {
      // Initiator is on local network — arc starts at home, ends at external responder
      srcIp = initiatorIP;
      dstIp = responderIP;
    } else if (responderPrivate) {
      // Responder is private — arc starts at external initiator, ends at home
      srcIp = initiatorIP;
      dstIp = responderIP;
    } else {
      // Both are external — use as-is
      srcIp = initiatorIP;
      dstIp = responderIP;
    }

    let srcGeo = this.geoLookup(srcIp);
    let dstGeo = this.geoLookup(dstIp);

    // Apply home location for private/local IPs
    if ((isPrivateIP(srcIp) || this.isLocalResponder(srcIp)) && !srcGeo && this.homeLocation) {
      srcGeo = {
        country: this.homeLocation.country,
        region: this.homeLocation.region,
        city: this.homeLocation.city,
        ll: [this.homeLocation.coordinates[1], this.homeLocation.coordinates[0]]
      };
    }

    if ((isPrivateIP(dstIp) || this.isLocalResponder(dstIp)) && !dstGeo && this.homeLocation) {
      dstGeo = {
        country: this.homeLocation.country,
        region: this.homeLocation.region,
        city: this.homeLocation.city,
        ll: [this.homeLocation.coordinates[1], this.homeLocation.coordinates[0]]
      };
    }

    if (!srcGeo && !dstGeo) return;

    const threat = this.getThreatColor(entry);
    const threatInfo = entry.IP_ReputationSI_Category || entry.IntrusionRuleMessage || '';
    const classification = entry.Classification || '';

    const protocol = PROTOCOL_MAP[(entry.Protocol || '').toLowerCase()] || 0;

    const connection = {
      type: 'connection',
      mode: 'syslog',
      timestamp: Date.now(),
      source: {
        ip: srcIp,
        country: srcGeo?.country || 'Unknown',
        region: srcGeo?.region || '',
        city: srcGeo?.city || 'Unknown',
        coordinates: srcGeo ? [srcGeo.ll[1], srcGeo.ll[0]] : null
      },
      destination: {
        ip: dstIp,
        country: dstGeo?.country || 'Unknown',
        region: dstGeo?.region || '',
        city: dstGeo?.city || 'Unknown',
        coordinates: dstGeo ? [dstGeo.ll[1], dstGeo.ll[0]] : null
      },
      protocol,
      threatColor: threat.color,
      threatLevel: threat.level,
      threatInfo,
      classification,
      priorityId: entry.PriorityID || null,
      reputationCategory: entry.IP_ReputationSI_Category || null,
      ruleAction: entry.AC_RuleAction || entry.InlineResult || ''
    };

    if (connection.source.coordinates && connection.destination.coordinates) {
      callback(connection);
    }
  }

  startFromFile(filePath, callback) {
    this.stop();

    if (!fs.existsSync(filePath)) {
      throw new Error(`Syslog file not found: ${filePath}`);
    }

    this.isRunning = true;

    // Stream the file line-by-line to handle large exports (100s of MB)
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity
    });

    const parsed = [];
    let isJsonArray = false;
    let jsonArrayBuf = '';

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Detect JSON array format on first meaningful character
      if (parsed.length === 0 && !isJsonArray && trimmed.startsWith('[')) {
        isJsonArray = true;
      }

      if (isJsonArray) {
        // Accumulate the whole JSON array (old format — small files only)
        jsonArrayBuf += line + '\n';
        return;
      }

      // NDJSON format: each line is a JSON object
      try {
        const obj = JSON.parse(trimmed);
        // Splunk NDJSON: extract result._raw which contains the syslog string
        const rawSyslog = (obj.result && obj.result._raw) ? obj.result._raw : trimmed;
        const entry = this.parseSyslogEntry(rawSyslog);
        if (entry) parsed.push(entry);
      } catch (err) {
        // Not valid JSON — treat the line itself as a raw syslog string
        const entry = this.parseSyslogEntry(trimmed);
        if (entry) parsed.push(entry);
      }
    });

    rl.on('close', () => {
      // Handle old JSON array format
      if (isJsonArray && jsonArrayBuf) {
        try {
          const entries = JSON.parse(jsonArrayBuf);
          if (Array.isArray(entries)) {
            for (const e of entries) {
              const entry = this.parseSyslogEntry(e);
              if (entry) parsed.push(entry);
            }
          }
        } catch (err) {
          logger.error(`Failed to parse JSON array file: ${err.message}`);
        }
      }

      logger.info(`Loaded ${parsed.length} syslog entries from file`);

      let index = 0;
      const replayNext = () => {
        if (!this.isRunning) return;
        if (index >= parsed.length) {
          index = 0;
        }

        this.processEntry(parsed[index], callback);
        index++;

        this.replayTimer = setTimeout(replayNext, 80);
      };

      replayNext();
    });

    rl.on('error', (err) => {
      this.isRunning = false;
      logger.error(`Failed to read syslog file: ${err.message}`);
    });
  }

  startLive(port, callback) {
    this.stop();
    this.isRunning = true;

    const listenPort = parseInt(port) || 514;
    logger.info(`Starting live syslog listener on UDP+TCP port ${listenPort}`);

    // UDP listener
    this.udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udpServer.on('message', (msg) => {
      if (!this.isRunning) return;
      this.handleRawSyslog(msg.toString('utf-8'), callback);
    });
    this.udpServer.on('error', (err) => {
      logger.error('UDP server error', err.message);
    });
    this.udpServer.bind(listenPort, () => {
      logger.info(`UDP syslog listening on port ${listenPort}`);
    });

    // TCP listener (some devices send syslog over TCP)
    this.tcpServer = net.createServer((socket) => {
      this.tcpSockets.add(socket);
      let buffer = '';
      socket.on('data', (data) => {
        if (!this.isRunning) return;
        buffer += data.toString('utf-8');
        // Split on newlines — each line is a syslog message
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete trailing line in buffer
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) this.handleRawSyslog(trimmed, callback);
        }
      });
      socket.on('close', () => this.tcpSockets.delete(socket));
      socket.on('error', () => this.tcpSockets.delete(socket));
    });
    this.tcpServer.on('error', (err) => {
      logger.error('TCP server error', err.message);
    });
    this.tcpServer.listen(listenPort, () => {
      logger.info(`TCP syslog listening on port ${listenPort}`);
    });
  }

  handleRawSyslog(raw, callback) {
    const entry = this.parseSyslogEntry(raw);
    if (entry) {
      this.processEntry(entry, callback);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
    if (this.udpServer) {
      try { this.udpServer.close(); } catch (e) {}
      this.udpServer = null;
    }
    if (this.tcpServer) {
      for (const sock of this.tcpSockets) {
        try { sock.destroy(); } catch (e) {}
      }
      this.tcpSockets.clear();
      try { this.tcpServer.close(); } catch (e) {}
      this.tcpServer = null;
    }
  }
}

module.exports = SyslogProcessor;
