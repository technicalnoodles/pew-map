const pcap = require('pcap');
const geoip = require('geoip-lite');
const fs = require('fs');
const logger = require('./logger')('PacketProcessor');

const GEO_CACHE_MAX = 4096;

const PACKETS_PER_SECOND = 500;

class PacketProcessor {
  constructor(homeLocation = null) {
    this.session = null;
    this.isRunning = false;
    this.homeLocation = homeLocation || this.loadHomeLocation();
    this.geoCache = new Map();
    this.tokenBucket = PACKETS_PER_SECOND;
    this.tokenInterval = null;
  }

  loadHomeLocation() {
    if (process.env.HOME_LATITUDE && process.env.HOME_LONGITUDE) {
      const lat = parseFloat(process.env.HOME_LATITUDE);
      const lon = parseFloat(process.env.HOME_LONGITUDE);
      const country = process.env.HOME_COUNTRY || 'Unknown';
      const region = process.env.HOME_STATE || '';
      const city = process.env.HOME_CITY || 'Unknown';
      
      logger.info(`Using env vars — lat: ${lat}, lon: ${lon} (${city}, ${region}, ${country})`);
      return {
        country,
        region,
        city,
        coordinates: [lon, lat]
      };
    }
    
    return this.detectHomeLocation();
  }

  detectHomeLocation() {
    const geoip = require('geoip-lite');

    // Try to get public IP and geolocate it
    try {
      const { execSync } = require('child_process');
      const publicIp = execSync('curl -s --max-time 3 https://api.ipify.org', { encoding: 'utf8' }).trim();
      if (publicIp) {
        const geo = geoip.lookup(publicIp);
        if (geo) {
          logger.info(`Autodetected home from public IP ${publicIp} — lat: ${geo.ll[0]}, lon: ${geo.ll[1]} (${geo.city || 'Unknown'}, ${geo.region || ''}, ${geo.country})`);
          return {
            country: geo.country,
            region: geo.region || '',
            city: geo.city || 'Unknown',
            coordinates: [geo.ll[1], geo.ll[0]]
          };
        }
      }
    } catch (err) {
      logger.warn('Failed to detect public IP', err.message);
    }
    
    return null;
  }

  listInterfaces() {
    try {
      logger.debug('Calling pcap.findalldevs()...');
      const devices = pcap.findalldevs();
      logger.debug('Found interfaces', devices);
      return devices.map(dev => ({
        name: dev.name,
        description: dev.description || dev.name,
        addresses: dev.addresses
      }));
    } catch (err) {
      logger.error('Error listing interfaces', err.message);
      return [];
    }
  }

  startLiveCapture(iface, callback) {
    try {
      this.stop();
      
      const device = iface || pcap.findalldevs()[0]?.name;
      
      if (!device) {
        throw new Error('No network interface available');
      }

      // Try with BPF filter first; fall back to no filter for SPAN interfaces without IPv4
      try {
        this.session = pcap.createSession(device, 'ip or ip6');
      } catch (filterErr) {
        logger.warn('BPF filter failed, falling back to unfiltered capture', filterErr.message);
        this.session = pcap.createSession(device, '');
      }
      this.isRunning = true;

      // Refill token bucket at a fixed rate to cap packet processing
      this.tokenBucket = PACKETS_PER_SECOND;
      this.tokenInterval = setInterval(() => {
        this.tokenBucket = PACKETS_PER_SECOND;
      }, 1000);

      this.session.on('packet', (raw_packet) => {
        if (this.tokenBucket <= 0) return;
        this.tokenBucket--;
        this.processPacket(raw_packet, callback);
      });

      this.session.on('error', (err) => {
        logger.error('Capture error', err.message);
        this.stop();
      });

    } catch (err) {
      logger.error('Failed to start live capture', err.message);
      throw err;
    }
  }

  startFromFile(pcapFile, callback) {
    try {
      this.stop();

      if (!fs.existsSync(pcapFile)) {
        throw new Error(`PCAP file not found: ${pcapFile}`);
      }

      this.session = pcap.createOfflineSession(pcapFile, 'ip or ip6');
      this.isRunning = true;

      this.session.on('packet', (raw_packet) => {
        this.processPacket(raw_packet, callback);
      });

      this.session.on('complete', () => {
        this.stop();
      });

    } catch (err) {
      logger.error('Failed to read PCAP file', err.message);
      throw err;
    }
  }

  processPacket(raw_packet, callback) {
    try {
      const packet = pcap.decode.packet(raw_packet);
      
      if (!packet.payload || !packet.payload.payload) {
        return;
      }

      const ipPacket = packet.payload.payload;
      const srcIp = this.extractIP(ipPacket, 'saddr');
      const dstIp = this.extractIP(ipPacket, 'daddr');

      if (!srcIp || !dstIp) {
        return;
      }

      if (this.isPrivateIP(srcIp) && this.isPrivateIP(dstIp)) {
        return;
      }

      let srcGeo = this.geoLookup(srcIp);
      let dstGeo = this.geoLookup(dstIp);

      if (this.isPrivateIP(srcIp) && !srcGeo) {
        srcGeo = {
          country: this.homeLocation.country,
          city: this.homeLocation.city,
          ll: [this.homeLocation.coordinates[1], this.homeLocation.coordinates[0]]
        };
      }

      if (this.isPrivateIP(dstIp) && !dstGeo) {
        dstGeo = {
          country: this.homeLocation.country,
          city: this.homeLocation.city,
          ll: [this.homeLocation.coordinates[1], this.homeLocation.coordinates[0]]
        };
      }

      if (!srcGeo && !dstGeo) {
        return;
      }

      const connection = {
        type: 'connection',
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
        protocol: ipPacket.protocol || 'unknown'
      };

      if (connection.source.coordinates && connection.destination.coordinates) {
        callback(connection);
      }

    } catch (err) {
      // Silently skip packets the pcap decoder can't handle (e.g. TCP option 30 / MPTCP)
    }
  }

  extractIP(ipPacket, field) {
    const addr = ipPacket[field];
    if (!addr || !addr.addr) return null;

    if (addr.addr.length === 4) {
      return addr.addr.join('.');
    }

    if (addr.addr.length === 16) {
      const groups = [];
      for (let i = 0; i < 16; i += 2) {
        groups.push(((addr.addr[i] << 8) | addr.addr[i + 1]).toString(16));
      }
      return groups.join(':').replace(/(^|:)0(:0)*(:|$)/, '::');
    }

    return null;
  }

  geoLookup(ip) {
    const cached = this.geoCache.get(ip);
    if (cached !== undefined) return cached;
    const result = geoip.lookup(ip);
    if (this.geoCache.size >= GEO_CACHE_MAX) {
      // Evict oldest entry
      this.geoCache.delete(this.geoCache.keys().next().value);
    }
    this.geoCache.set(ip, result);
    return result;
  }

  isPrivateIP(ip) {
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

  stop() {
    if (this.tokenInterval) {
      clearInterval(this.tokenInterval);
      this.tokenInterval = null;
    }
    if (this.session) {
      try {
        this.session.close();
      } catch (err) {
        logger.error('Error closing session', err.message);
      }
      this.session = null;
    }
    this.isRunning = false;
  }
}

module.exports = PacketProcessor;
