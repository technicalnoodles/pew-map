const geoip = require('geoip-lite');

const GEO_CACHE_MAX = 4096;

function loadHomeLocation(logger) {
  if (process.env.HOME_LATITUDE && process.env.HOME_LONGITUDE) {
    const lat = parseFloat(process.env.HOME_LATITUDE);
    const lon = parseFloat(process.env.HOME_LONGITUDE);
    const country = process.env.HOME_COUNTRY || 'Unknown';
    const region = process.env.HOME_STATE || '';
    const city = process.env.HOME_CITY || 'Unknown';

    if (logger) {
      logger.info(`Using env vars — lat: ${lat}, lon: ${lon} (${city}, ${region}, ${country})`);
    }
    return { country, region, city, coordinates: [lon, lat] };
  }
  return detectHomeLocation(logger);
}

function detectHomeLocation(logger) {
  try {
    const { execSync } = require('child_process');
    const publicIp = execSync('curl -s --max-time 3 https://api.ipify.org', { encoding: 'utf8' }).trim();
    if (publicIp) {
      const geo = geoip.lookup(publicIp);
      if (geo) {
        if (logger) {
          logger.info(`Autodetected home from public IP ${publicIp} — lat: ${geo.ll[0]}, lon: ${geo.ll[1]} (${geo.city || 'Unknown'}, ${geo.region || ''}, ${geo.country})`);
        }
        return {
          country: geo.country,
          region: geo.region || '',
          city: geo.city || 'Unknown',
          coordinates: [geo.ll[1], geo.ll[0]]
        };
      }
    }
  } catch (err) {
    if (logger) {
      logger.warn('Failed to detect public IP', err.message);
    }
  }
  return null;
}

function createGeoCache() {
  const cache = new Map();

  function lookup(ip) {
    const cached = cache.get(ip);
    if (cached !== undefined) return cached;
    const result = geoip.lookup(ip);
    if (cache.size >= GEO_CACHE_MAX) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(ip, result);
    return result;
  }

  return { lookup, cache };
}

function isPrivateIP(ip) {
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

module.exports = { loadHomeLocation, detectHomeLocation, createGeoCache, isPrivateIP };
