import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

export default function MapContainer({ 
  connections, 
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
  const maxConcurrentConnections = 50;
  const connectionQueue = useRef([]);
  const processingQueue = useRef(false);
  const worldMapRef = useRef(null);

  useEffect(() => {
    fetch('https://code.highcharts.com/mapdata/custom/world.topo.json')
      .then(response => response.json())
      .then(data => {
        setTopology(data);
        initializeMap(data);
      })
      .catch(err => console.error('Failed to load map topology:', err));

    const rateInterval = setInterval(() => {
      onConnectionRateChange(lastSecondCount.current);
      lastSecondCount.current = 0;
    }, 1000);

    return () => clearInterval(rateInterval);
  }, []);

  useEffect(() => {
    if (connections.length > 0 && chartRef.current) {
      const connection = connections[0];
      lastSecondCount.current++;
      
      countriesSet.current.add(connection.source.country);
      countriesSet.current.add(connection.destination.country);
      onCountriesCountChange(countriesSet.current.size);

      if (activeConnections.current < maxConcurrentConnections) {
        connectionQueue.current.push(connection);
        processConnectionQueue();
      }
    }
  }, [connections]);

  const initializeMap = (topoData) => {
    const options = {
      chart: {
        map: topoData,
        backgroundColor: 'transparent',
        height: 600
      },
      title: {
        text: '',
        style: { color: '#ffffff' }
      },
      credits: {
        enabled: false
      },
      mapNavigation: {
        enabled: true,
        buttonOptions: {
          theme: {
            fill: 'rgba(0, 0, 0, 0.3)',
            'stroke-width': 1,
            stroke: 'rgba(255, 255, 255, 0.2)',
            style: { color: '#ffffff' },
            states: {
              hover: {
                fill: 'rgba(0, 168, 255, 0.5)'
              },
              select: {
                fill: 'rgba(0, 168, 255, 0.7)'
              }
            }
          }
        }
      },
      legend: {
        enabled: false
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderColor: '#00a8ff',
        style: {
          color: '#ffffff'
        }
      },
      series: [{
        name: 'World',
        borderColor: 'rgba(100, 100, 120, 0.3)',
        nullColor: 'rgba(20, 20, 30, 0.8)',
        showInLegend: false
      }]
    };

    setMapOptions(options);
  };

  const processConnectionQueue = () => {
    if (processingQueue.current || connectionQueue.current.length === 0) {
      return;
    }

    processingQueue.current = true;

    const connection = connectionQueue.current.shift();
    const srcCoords = connection.source.coordinates;
    const dstCoords = connection.destination.coordinates;

    if (!srcCoords || !dstCoords || !chartRef.current) {
      processingQueue.current = false;
      processConnectionQueue();
      return;
    }

    activeConnections.current++;
    onActiveConnectionsChange(activeConnections.current);

    const chart = chartRef.current.chart;
    const seriesId = `connection-${seriesCounter.current++}`;
    
    const lineColor = getConnectionColor(connection.protocol);
    
    // Add the main connection line with glow effect
    chart.addSeries({
      id: seriesId,
      type: 'mapline',
      name: `${connection.source.country} → ${connection.destination.country}`,
      data: [{
        geometry: {
          type: 'LineString',
          coordinates: [
            [srcCoords[0], srcCoords[1]],
            [dstCoords[0], dstCoords[1]]
          ]
        }
      }],
      color: lineColor,
      lineWidth: 3,
      opacity: 1,
      enableMouseTracking: true,
      dashStyle: 'Solid',
      shadow: {
        color: lineColor,
        width: 10,
        opacity: 0.8
      },
      tooltip: {
        headerFormat: '',
        pointFormat: `
          <b>Connection</b><br/>
          From: ${connection.source.ip}<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;${formatLocation(connection.source)}<br/>
          To: ${connection.destination.ip}<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;${formatLocation(connection.destination)}<br/>
          Protocol: ${connection.protocol}
        `
      },
      animation: {
        duration: animationDuration
      },
      states: {
        hover: {
          lineWidth: 5,
          opacity: 1
        }
      }
    }, false);

    // Add source point marker
    chart.addSeries({
      id: `${seriesId}-src`,
      type: 'mappoint',
      data: [{
        geometry: {
          type: 'Point',
          coordinates: srcCoords
        }
      }],
      marker: {
        radius: 6,
        fillColor: lineColor,
        lineWidth: 2,
        lineColor: '#ffffff',
        symbol: 'circle',
        states: {
          hover: {
            radiusPlus: 2
          }
        }
      },
      enableMouseTracking: false,
      animation: {
        duration: 300
      }
    }, false);

    // Add destination point marker with pulse effect
    chart.addSeries({
      id: `${seriesId}-dst`,
      type: 'mappoint',
      data: [{
        geometry: {
          type: 'Point',
          coordinates: dstCoords
        }
      }],
      marker: {
        radius: 8,
        fillColor: lineColor,
        lineWidth: 3,
        lineColor: '#ffffff',
        symbol: 'circle',
        states: {
          hover: {
            radiusPlus: 3
          }
        }
      },
      enableMouseTracking: false,
      animation: {
        duration: animationDuration
      }
    }, false);

    scheduleRedraw();

    setTimeout(() => {
      const series = chart.get(seriesId);
      
      if (series) {
        series.remove(false);
        scheduleRedraw();
      }
      
      activeConnections.current--;
      onActiveConnectionsChange(activeConnections.current);
      
      processingQueue.current = false;
      processConnectionQueue();
    }, animationDuration);

    setTimeout(() => {
      processingQueue.current = false;
      processConnectionQueue();
    }, 100);
  };

  const scheduleRedraw = () => {
    if (pendingRedraws.current || !chartRef.current) {
      return;
    }

    pendingRedraws.current = true;
    requestAnimationFrame(() => {
      if (chartRef.current) {
        chartRef.current.chart.redraw();
      }
      pendingRedraws.current = false;
    });
  };

  const getConnectionColor = (protocol) => {
    const colors = {
      6: '#00f5ff',
      17: '#00ff88',
      1: '#ff6b6b',
      default: '#ffd700'
    };
    
    return colors[protocol] || colors.default;
  };

  const formatLocation = (location) => {
    const parts = [];
    
    if (location.city && location.city !== 'Unknown') {
      parts.push(location.city);
    }
    
    if (location.region) {
      parts.push(location.region);
    }
    
    if (location.country && location.country !== 'Unknown') {
      parts.push(location.country);
    }
    
    return parts.length > 0 ? parts.join(', ') : 'Unknown';
  };

  if (!mapOptions) {
    return (
      <div id="map-container">
        <p style={{ color: 'white', padding: '20px', textAlign: 'center' }}>
          Loading map...
        </p>
      </div>
    );
  }

  return (
    <div id="map-container">
      <HighchartsReact
        highcharts={Highcharts}
        constructorType={'mapChart'}
        options={mapOptions}
        ref={chartRef}
      />
    </div>
  );
}
