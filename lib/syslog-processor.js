const geoip = require('geoip-lite');
const fs = require('fs');
const dgram = require('dgram');
const net = require('net');

const GEO_CACHE_MAX = 4096;

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
    this.homeLocation = homeLocation || this.loadHomeLocation();
    this.replayTimer = null;
    this.udpServer = null;
    this.tcpServer = null;
    this.tcpSockets = new Set();
    this.geoCache = new Map();
  }

  loadHomeLocation() {
    if (process.env.HOME_LATITUDE && process.env.HOME_LONGITUDE) {
      const lat = parseFloat(process.env.HOME_LATITUDE);
      const lon = parseFloat(process.env.HOME_LONGITUDE);
      const country = process.env.HOME_COUNTRY || 'Unknown';
      const region = process.env.HOME_STATE || '';
      const city = process.env.HOME_CITY || 'Unknown';
      return { country, region, city, coordinates: [lon, lat] };
    }
    return this.detectHomeLocation();
  }

  detectHomeLocation() {
    try {
      const { execSync } = require('child_process');
      const publicIp = execSync('curl -s --max-time 3 https://api.ipify.org', { encoding: 'utf8' }).trim();
      if (publicIp) {
        const geo = geoip.lookup(publicIp);
        if (geo) {
          return {
            country: geo.country,
            region: geo.region || '',
            city: geo.city || 'Unknown',
            coordinates: [geo.ll[1], geo.ll[0]]
          };
        }
      }
    } catch (err) {
      console.warn('[SyslogProcessor] Failed to detect public IP:', err.message);
    }
    return null;
  }

  geoLookup(ip) {
    const cached = this.geoCache.get(ip);
    if (cached !== undefined) return cached;
    const result = geoip.lookup(ip);
    if (this.geoCache.size >= GEO_CACHE_MAX) {
      this.geoCache.delete(this.geoCache.keys().next().value);
    }
    this.geoCache.set(ip, result);
    return result;
  }

  isPrivateIP(ip) {
    if (!ip) return false;

    if (ip.includes(':')) {
      const lower = ip.toLowerCase();
      return (
        lower === '::1' ||
        lower.startsWith('fe80') ||
        lower.startsWith('fc') ||
        lower.startsWith('fd') ||
        lower.startsWith('::ffff:127.')
      );
    }

    const dot1 = ip.indexOf('.');
    const first = parseInt(ip.substring(0, dot1), 10);
    if (first === 10 || first === 127) return true;

    const dot2 = ip.indexOf('.', dot1 + 1);
    const second = parseInt(ip.substring(dot1 + 1, dot2), 10);
    return (
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }

  isLocalResponder(ip) {
    return LOCAL_RESPONDER_IPS.has(ip);
  }

  parseSyslogEntry(raw) {
    // Only process IPS (430001) and Security Intelligence (430002) events
    if (!raw.includes('430001') && !raw.includes('430002')) return null;

    const jsonStart = raw.indexOf('{');
    if (jsonStart === -1) return null;

    try {
      const jsonStr = raw.substring(jsonStart);
      return JSON.parse(jsonStr);
    } catch (err) {
      console.error('[SyslogProcessor] Failed to parse syslog JSON:', err.message);
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

    const initiatorPrivate = this.isPrivateIP(initiatorIP);
    const responderPrivate = this.isPrivateIP(responderIP);
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
    if ((this.isPrivateIP(srcIp) || this.isLocalResponder(srcIp)) && !srcGeo && this.homeLocation) {
      srcGeo = {
        country: this.homeLocation.country,
        region: this.homeLocation.region,
        city: this.homeLocation.city,
        ll: [this.homeLocation.coordinates[1], this.homeLocation.coordinates[0]]
      };
    }

    if ((this.isPrivateIP(dstIp) || this.isLocalResponder(dstIp)) && !dstGeo && this.homeLocation) {
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

    // Read file asynchronously to avoid blocking the event loop
    fs.readFile(filePath, 'utf-8', (readErr, raw) => {
      if (readErr) {
        this.isRunning = false;
        console.error(`Failed to read syslog file: ${readErr.message}`);
        return;
      }

      let entries;
      try {
        entries = JSON.parse(raw);
      } catch (err) {
        this.isRunning = false;
        console.error(`Failed to parse syslog JSON file: ${err.message}`);
        return;
      }

      if (!Array.isArray(entries)) {
        this.isRunning = false;
        console.error('Syslog file must contain a JSON array of syslog strings');
        return;
      }

      // Parse all entries and replay them with a delay to simulate real-time
      const parsed = entries
        .map(e => this.parseSyslogEntry(e))
        .filter(Boolean);

      let index = 0;
      const replayNext = () => {
        if (!this.isRunning || index >= parsed.length) {
          this.isRunning = false;
          return;
        }

        const batchSize = Math.min(3, parsed.length - index);
        for (let i = 0; i < batchSize; i++) {
          this.processEntry(parsed[index], callback);
          index++;
        }

        this.replayTimer = setTimeout(replayNext, 800);
      };

      replayNext();
    });
  }

  startLive(port, callback) {
    this.stop();
    this.isRunning = true;

    const listenPort = parseInt(port) || 514;
    console.log(`[SyslogProcessor] Starting live syslog listener on UDP+TCP port ${listenPort}`);

    // UDP listener
    this.udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udpServer.on('message', (msg) => {
      if (!this.isRunning) return;
      this.handleRawSyslog(msg.toString('utf-8'), callback);
    });
    this.udpServer.on('error', (err) => {
      console.error('[SyslogProcessor] UDP server error:', err.message);
    });
    this.udpServer.bind(listenPort, () => {
      console.log(`[SyslogProcessor] UDP syslog listening on port ${listenPort}`);
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
      console.error('[SyslogProcessor] TCP server error:', err.message);
    });
    this.tcpServer.listen(listenPort, () => {
      console.log(`[SyslogProcessor] TCP syslog listening on port ${listenPort}`);
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
