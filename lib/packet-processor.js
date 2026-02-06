const pcap = require('pcap');
const geoip = require('geoip-lite');
const fs = require('fs');

class PacketProcessor {
  constructor(homeLocation = null) {
    this.session = null;
    this.isRunning = false;
    this.homeLocation = homeLocation || this.loadHomeLocation();
  }

  loadHomeLocation() {
    if (process.env.HOME_LATITUDE && process.env.HOME_LONGITUDE) {
      const lat = parseFloat(process.env.HOME_LATITUDE);
      const lon = parseFloat(process.env.HOME_LONGITUDE);
      const country = process.env.HOME_COUNTRY || 'Unknown';
      const region = process.env.HOME_STATE || '';
      const city = process.env.HOME_CITY || 'Unknown';
      
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
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && (iface.family === 'IPv4' || iface.family === 'IPv6')) {
          const geo = geoip.lookup(iface.address);
          if (geo) {
            return {
              country: geo.country,
              region: geo.region || '',
              city: geo.city || 'Unknown',
              coordinates: [geo.ll[1], geo.ll[0]]
            };
          }
        }
      }
    }
    
    return {
      country: 'US',
      city: 'Unkno',
      region: 'wn',
      coordinates: [-95.7129, 37.0902]
    };
  }

  listInterfaces() {
    try {
      const devices = pcap.findalldevs();
      return devices.map(dev => ({
        name: dev.name,
        description: dev.description || dev.name,
        addresses: dev.addresses
      }));
    } catch (err) {
      console.error('Error listing interfaces:', err);
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

      this.session = pcap.createSession(device, 'ip or ip6');
      this.isRunning = true;

      this.session.on('packet', (raw_packet) => {
        this.processPacket(raw_packet, callback);
      });

      this.session.on('error', (err) => {
        console.error('Capture error:', err);
        this.stop();
      });

    } catch (err) {
      console.error('Failed to start live capture:', err);
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
      console.error('Failed to read PCAP file:', err);
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

      let srcGeo = geoip.lookup(srcIp);
      let dstGeo = geoip.lookup(dstIp);

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
      console.error('Error processing packet:', err);
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

    const parts = ip.split('.').map(Number);
    
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }

  stop() {
    if (this.session) {
      try {
        this.session.close();
      } catch (err) {
        console.error('Error closing session:', err);
      }
      this.session = null;
    }
    this.isRunning = false;
  }
}

module.exports = PacketProcessor;
