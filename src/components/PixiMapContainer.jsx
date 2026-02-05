import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

export default function PixiMapContainer({ 
  connectionBatch, 
  onActiveConnectionsChange,
  onCountriesCountChange,
  onConnectionRateChange 
}) {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const activeConnections = useRef(0);
  const countriesSet = useRef(new Set());
  const lastSecondCount = useRef(0);
  const animationDuration = 2000;
  const maxConcurrentConnections = 100;
  const connectionsLayer = useRef(null);
  const activeRoutes = useRef(new Map());
  const projectileTextureRef = useRef(null);
  const MAX_PROJECTILES_PER_ROUTE = 5;

  // Mercator projection
  const projectCoordinates = (lon, lat, width, height) => {
    const x = (lon + 180) * (width / 360);
    const latRad = (lat * Math.PI) / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const y = height / 2 - (width * mercN) / (2 * Math.PI);
    return { x, y };
  };

  useEffect(() => {
    if (!containerRef.current || appRef.current) return;

    // Create PixiJS application with cyberpunk dark background
    const app = new PIXI.Application({
      width: containerRef.current.clientWidth,
      height: 600,
      backgroundColor: 0x000000,
      antialias: false,
      resolution: 1,
      autoDensity: false
    });

    // Create shared projectile texture (reused by all projectiles)
    const pGfx = new PIXI.Graphics();
    pGfx.beginFill(0xffffff, 1);
    pGfx.drawCircle(0, 0, 5);
    pGfx.endFill();
    projectileTextureRef.current = app.renderer.generateTexture(pGfx);
    pGfx.destroy();

    containerRef.current.appendChild(app.view);
    appRef.current = app;

    // Create world map background
    const mapContainer = new PIXI.Container();
    app.stage.addChild(mapContainer);

    // Load and display world map image
    loadWorldMap(app, mapContainer);

    // Create connections layer
    connectionsLayer.current = new PIXI.Container();
    app.stage.addChild(connectionsLayer.current);

    // Rate counter
    const rateInterval = setInterval(() => {
      onConnectionRateChange(lastSecondCount.current);
      lastSecondCount.current = 0;
    }, 1000);

    return () => {
      clearInterval(rateInterval);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    };
  }, []);

  const addScanlines = (app, container) => {
    const scanlines = new PIXI.Graphics();
    scanlines.lineStyle(1, 0x00C48C, 0.05);
    
    const height = app.screen.height;
    const width = app.screen.width;
    
    for (let y = 0; y < height; y += 4) {
      scanlines.moveTo(0, y);
      scanlines.lineTo(width, y);
    }
    
    container.addChild(scanlines);
  };

  const loadWorldMap = async (app, container) => {
    const width = app.screen.width;
    const height = app.screen.height;

    // Draw dotted continents
    drawDottedContinents(app, container);
    
    // Add subtle grid overlay
    const grid = new PIXI.Graphics();
    grid.lineStyle(1, 0x00C48C, 0.08);
    
    // Longitude lines
    for (let lon = -180; lon <= 180; lon += 30) {
      const start = projectCoordinates(lon, -85, width, height);
      const end = projectCoordinates(lon, 85, width, height);
      grid.moveTo(start.x, start.y);
      grid.lineTo(end.x, end.y);
    }
    
    // Latitude lines
    for (let lat = -80; lat <= 80; lat += 20) {
      const start = projectCoordinates(-180, lat, width, height);
      const end = projectCoordinates(180, lat, width, height);
      grid.moveTo(start.x, start.y);
      grid.lineTo(end.x, end.y);
    }
    
    container.addChild(grid);
    
    // Add cyberpunk scanlines effect
    addScanlines(app, container);
  };

  const drawDottedContinents = async (app, container) => {
    const dotContainer = new PIXI.Container();
    const width = app.screen.width;
    const height = app.screen.height;

    try {
      // Fetch real country boundary GeoJSON
      const response = await fetch(
        'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
      );
      const topology = await response.json();
      
      // Convert TopoJSON to polygons
      const countries = topojsonToPolygons(topology);
      
      const dotRadius = 1.5;
      const dotColor = 0x00C48C;
      const dotAlpha = 0.55;
      const graphics = new PIXI.Graphics();
      graphics.beginFill(dotColor, dotAlpha);
      
      // Sample points globally, draw dot if inside any country
      for (let lon = -180; lon <= 180; lon += 3) {
        for (let lat = -80; lat <= 80; lat += 3) {
          let inside = false;
          
          for (const poly of countries) {
            if (pointInPolygon(lon, lat, poly)) {
              inside = true;
              break;
            }
          }
          
          if (inside) {
            const pos = projectCoordinates(lon, lat, width, height);
            if (pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height) {
              graphics.drawCircle(pos.x, pos.y, dotRadius);
            }
          }
        }
      }
      
      graphics.endFill();
      dotContainer.addChild(graphics);
    } catch (error) {
      console.error('Failed to load GeoJSON, using fallback:', error);
      // Fallback: simple text indicator
      const text = new PIXI.Text('Map loading failed', {
        fill: 0x00C48C,
        fontSize: 14
      });
      text.position.set(width / 2 - 60, height / 2);
      dotContainer.addChild(text);
    }
    
    container.addChild(dotContainer);
  };

  // Convert TopoJSON to flat array of polygon coordinate arrays
  const topojsonToPolygons = (topology) => {
    const polygons = [];
    const obj = topology.objects.countries;
    const arcs = topology.arcs;
    const transform = topology.transform;
    
    // Decode arc coordinates
    const decodedArcs = arcs.map(arc => {
      const coords = [];
      let x = 0, y = 0;
      arc.forEach(([dx, dy]) => {
        x += dx;
        y += dy;
        coords.push([
          x * transform.scale[0] + transform.translate[0],
          y * transform.scale[1] + transform.translate[1]
        ]);
      });
      return coords;
    });
    
    // Extract polygons from each geometry
    obj.geometries.forEach(geom => {
      if (geom.type === 'Polygon') {
        geom.arcs.forEach(ring => {
          const coords = decodeRing(ring, decodedArcs);
          if (coords.length > 3) polygons.push(coords);
        });
      } else if (geom.type === 'MultiPolygon') {
        geom.arcs.forEach(polygon => {
          polygon.forEach(ring => {
            const coords = decodeRing(ring, decodedArcs);
            if (coords.length > 3) polygons.push(coords);
          });
        });
      }
    });
    
    return polygons;
  };
  
  // Decode a ring of arc indices into coordinates
  const decodeRing = (ring, decodedArcs) => {
    const coords = [];
    ring.forEach(arcIdx => {
      let arc;
      if (arcIdx >= 0) {
        arc = decodedArcs[arcIdx];
      } else {
        arc = [...decodedArcs[~arcIdx]].reverse();
      }
      coords.push(...arc);
    });
    return coords;
  };

  // Point-in-polygon test using ray casting algorithm
  const pointInPolygon = (lon, lat, polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      
      const intersect = ((yi > lat) !== (yj > lat))
        && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  useEffect(() => {
    if (!connectionBatch || connectionBatch.length === 0 || !appRef.current) return;

    lastSecondCount.current += connectionBatch.length;

    for (const connection of connectionBatch) {
      countriesSet.current.add(connection.source?.country);
      countriesSet.current.add(connection.destination?.country);

      const srcCoords = connection.source?.coordinates;
      const dstCoords = connection.destination?.coordinates;
      if (!srcCoords || !dstCoords) continue;

      const routeKey = `${Math.round(srcCoords[0])},${Math.round(srcCoords[1])}->${Math.round(dstCoords[0])},${Math.round(dstCoords[1])}`;

      const existingRoute = activeRoutes.current.get(routeKey);
      if (existingRoute) {
        spawnProjectile(existingRoute, connection);
      } else if (activeConnections.current < maxConcurrentConnections) {
        activeConnections.current++;
        onActiveConnectionsChange(activeConnections.current);
        drawAnimatedConnection(connection, srcCoords, dstCoords, routeKey);
      }
    }

    onCountriesCountChange(countriesSet.current.size);
  }, [connectionBatch]);

  // Spawn an extra projectile on an existing route's line
  const spawnProjectile = (routeData, connection) => {
    if (!appRef.current || !routeData.container || !routeData.container.parent) return;

    const color = getConnectionColor(connection.protocol);
    const colorHex = parseInt(color.replace('#', ''), 16);
    const { src, dst, midX, controlY, container, dstMarker } = routeData;

    // Cap projectiles per route to prevent memory buildup
    if (!routeData.projectileCount) routeData.projectileCount = 0;
    if (routeData.projectileCount >= MAX_PROJECTILES_PER_ROUTE) return;
    routeData.projectileCount++;

    const projectile = new PIXI.Sprite(projectileTextureRef.current);
    projectile.anchor.set(0.5);
    projectile.scale.set(0.8);
    projectile.tint = colorHex;
    container.addChild(projectile);

    // Reset the route timeout (keep the line alive longer)
    if (routeData.timeout) clearTimeout(routeData.timeout);
    routeData.timeout = setTimeout(() => {
      if (container.parent) {
        connectionsLayer.current.removeChild(container);
        container.destroy({ children: true });
      }
      activeRoutes.current.delete(routeData.routeKey);
      activeConnections.current--;
      onActiveConnectionsChange(activeConnections.current);
    }, animationDuration);

    // Animate the new projectile
    const startTime = Date.now();
    const animateProjectile = () => {
      if (!appRef.current || !container.parent) return;
      const t = (Date.now() - startTime) / animationDuration;

      if (t <= 1) {
        const x = Math.pow(1 - t, 2) * src.x + 2 * (1 - t) * t * midX + Math.pow(t, 2) * dst.x;
        const y = Math.pow(1 - t, 2) * src.y + 2 * (1 - t) * t * controlY + Math.pow(t, 2) * dst.y;
        projectile.position.set(x, y);

        // Pulse destination marker on each new dot
        const scale = 1 + Math.sin(t * Math.PI * 4) * 0.3;
        dstMarker.scale.set(scale);

        requestAnimationFrame(animateProjectile);
      } else {
        // Remove just this projectile when done
        if (projectile.parent) {
          container.removeChild(projectile);
          projectile.destroy();
        }
        if (routeData.projectileCount) routeData.projectileCount--;
      }
    };
    animateProjectile();
  };

  const drawAnimatedConnection = (connection, srcCoords, dstCoords, routeKey) => {
    if (!appRef.current || !connectionsLayer.current) return;

    const app = appRef.current;
    const width = app.screen.width;
    const height = app.screen.height;

    const src = projectCoordinates(srcCoords[0], srcCoords[1], width, height);
    const dst = projectCoordinates(dstCoords[0], dstCoords[1], width, height);

    const color = getConnectionColor(connection.protocol);
    const colorHex = parseInt(color.replace('#', ''), 16);

    // Create container for this connection
    const connectionContainer = new PIXI.Container();
    connectionsLayer.current.addChild(connectionContainer);

    // Calculate arc control point (higher arc for longer distances)
    const midX = (src.x + dst.x) / 2;
    const midY = (src.y + dst.y) / 2;
    const distance = Math.sqrt(Math.pow(dst.x - src.x, 2) + Math.pow(dst.y - src.y, 2));
    const arcHeight = Math.min(distance * 0.3, 200);
    const controlY = midY - arcHeight;

    // Draw glow layer (thick, transparent) + solid line (no BlurFilter = saves GBs of VRAM)
    const line = new PIXI.Graphics();
    line.lineStyle(10, colorHex, 0.15);
    line.moveTo(src.x, src.y);
    line.quadraticCurveTo(midX, controlY, dst.x, dst.y);
    line.lineStyle(3, colorHex, 0.9);
    line.moveTo(src.x, src.y);
    line.quadraticCurveTo(midX, controlY, dst.x, dst.y);
    connectionContainer.addChild(line);

    // Create source marker
    const srcMarker = new PIXI.Graphics();
    srcMarker.beginFill(colorHex, 1);
    srcMarker.drawCircle(0, 0, 6);
    srcMarker.endFill();
    srcMarker.lineStyle(2, 0xffffff, 1);
    srcMarker.drawCircle(0, 0, 6);
    srcMarker.position.set(src.x, src.y);
    connectionContainer.addChild(srcMarker);

    // Create destination marker
    const dstMarker = new PIXI.Graphics();
    dstMarker.beginFill(colorHex, 1);
    dstMarker.drawCircle(0, 0, 8);
    dstMarker.endFill();
    dstMarker.lineStyle(2, 0xffffff, 1);
    dstMarker.drawCircle(0, 0, 8);
    dstMarker.position.set(dst.x, dst.y);
    connectionContainer.addChild(dstMarker);

    // Store route data for reuse
    const routeData = {
      routeKey,
      container: connectionContainer,
      src, dst, midX, controlY, dstMarker,
      timeout: null
    };
    activeRoutes.current.set(routeKey, routeData);

    // Create animated projectile using shared texture
    const projectile = new PIXI.Sprite(projectileTextureRef.current);
    projectile.anchor.set(0.5);
    projectile.tint = colorHex;
    connectionContainer.addChild(projectile);

    // Animate projectile along the arc
    const startTime = Date.now();

    const animate = () => {
      if (!appRef.current || !connectionContainer.parent) return;

      const t = (Date.now() - startTime) / animationDuration;

      if (t <= 1) {
        const x = Math.pow(1 - t, 2) * src.x + 2 * (1 - t) * t * midX + Math.pow(t, 2) * dst.x;
        const y = Math.pow(1 - t, 2) * src.y + 2 * (1 - t) * t * controlY + Math.pow(t, 2) * dst.y;
        
        projectile.position.set(x, y);
        
        // Pulse the destination marker
        const scale = 1 + Math.sin(t * Math.PI * 4) * 0.2;
        dstMarker.scale.set(scale);

        requestAnimationFrame(animate);
      } else {
        // Remove just the first projectile
        if (projectile.parent) {
          connectionContainer.removeChild(projectile);
          projectile.destroy();
        }
      }
    };

    // Set timeout to remove the whole line after animation
    routeData.timeout = setTimeout(() => {
      if (connectionContainer.parent) {
        connectionsLayer.current.removeChild(connectionContainer);
        connectionContainer.destroy({ children: true });
      }
      activeRoutes.current.delete(routeKey);
      activeConnections.current--;
      onActiveConnectionsChange(activeConnections.current);
    }, animationDuration);

    animate();
  };

  const getConnectionColor = (protocol) => {
    // Splunk cyberpunk color palette
    const colors = {
      6: '#00C48C',      // TCP - Splunk Green
      17: '#FF006E',     // UDP - Neon Magenta/Pink
      1: '#FF5C00',      // ICMP - Neon Orange
      default: '#00F0FF' // Other - Neon Cyan
    };
    
    return colors[protocol] || colors.default;
  };

  return (
    <div 
      id="map-container" 
      ref={containerRef}
      style={{ 
        width: '100%', 
        height: '600px',
        backgroundColor: '#000000',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 0 40px rgba(0, 196, 140, 0.3), inset 0 0 60px rgba(255, 0, 110, 0.1)'
      }}
    />
  );
}
