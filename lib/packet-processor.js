const pcap = require('pcap');
const fs = require('fs');
const logger = require('./logger')('PacketProcessor');
const { loadHomeLocation, createGeoCache, isPrivateIP } = require('./geo-utils');

const PACKETS_PER_SECOND = 500;

class PacketProcessor {
  constructor(homeLocation = null) {
    this.session = null;
    this.isRunning = false;
    this.homeLocation = homeLocation || loadHomeLocation(logger);
    const geo = createGeoCache();
    this.geoLookup = geo.lookup;
    this.tokenBucket = PACKETS_PER_SECOND;
    this.tokenInterval = null;
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

      if (isPrivateIP(srcIp) && isPrivateIP(dstIp)) {
        return;
      }

      let srcGeo = this.geoLookup(srcIp);
      let dstGeo = this.geoLookup(dstIp);

      if (isPrivateIP(srcIp) && !srcGeo) {
        srcGeo = {
          country: this.homeLocation.country,
          city: this.homeLocation.city,
          ll: [this.homeLocation.coordinates[1], this.homeLocation.coordinates[0]]
        };
      }

      if (isPrivateIP(dstIp) && !dstGeo) {
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
