class MapVisualizer {
  constructor() {
    this.chart = null;
    this.ws = null;
    this.isRunning = false;
    this.totalConnections = 0;
    this.activeConnections = 0;
    this.countriesSet = new Set();
    this.connectionRate = 0;
    this.lastSecondCount = 0;
    this.animationDuration = 2000;
    this.seriesCounter = 0;
    this.maxConcurrentConnections = 50;
    this.pendingRedraws = false;
    this.connectionQueue = [];
    this.processingQueue = false;
    
    this.init();
  }

  async init() {
    await this.initMap();
    this.initControls();
    this.initWebSocket();
    this.startRateCounter();
  }

  async initMap() {
    try {
      const topology = await fetch('https://code.highcharts.com/mapdata/custom/world.topo.json')
        .then(response => response.json());

      this.chart = Highcharts.mapChart('map-container', {
        chart: {
          map: topology,
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
        borderColor: 'rgba(255, 255, 255, 0.2)',
        nullColor: 'rgba(50, 50, 70, 0.5)',
        showInLegend: false
      }]
    });
    } catch (err) {
      console.error('Failed to initialize map:', err);
      document.getElementById('map-container').innerHTML = '<p style="color: white; padding: 20px; text-align: center;">Failed to load map. Please refresh the page.</p>';
    }
  }

  initControls() {
    const sourceSelect = document.getElementById('source-select');
    const interfaceGroup = document.getElementById('interface-group');
    const fileGroup = document.getElementById('file-group');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const animationInput = document.getElementById('animation-duration');

    sourceSelect.addEventListener('change', (e) => {
      if (e.target.value === 'live') {
        interfaceGroup.classList.remove('hidden');
        fileGroup.classList.add('hidden');
      } else {
        interfaceGroup.classList.add('hidden');
        fileGroup.classList.remove('hidden');
      }
    });

    animationInput.addEventListener('change', (e) => {
      this.animationDuration = parseInt(e.target.value);
    });

    startBtn.addEventListener('click', () => this.startCapture());
    stopBtn.addEventListener('click', () => this.stopCapture());

    this.requestInterfaces();
  }

  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'connection') {
        this.addConnection(data);
      } else if (data.type === 'interfaces') {
        this.updateInterfaceList(data.data);
      } else if (data.type === 'error') {
        console.error('Server error:', data.message);
        alert(`Error: ${data.message}`);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      if (this.isRunning) {
        setTimeout(() => this.initWebSocket(), 3000);
      }
    };
  }

  requestInterfaces() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'list-interfaces' }));
    } else {
      setTimeout(() => this.requestInterfaces(), 1000);
    }
  }

  updateInterfaceList(interfaces) {
    const select = document.getElementById('interface-select');
    select.innerHTML = '';
    
    if (interfaces.length === 0) {
      select.innerHTML = '<option value="">No interfaces found</option>';
      return;
    }

    interfaces.forEach(iface => {
      const option = document.createElement('option');
      option.value = iface.name;
      option.textContent = iface.description || iface.name;
      select.appendChild(option);
    });
  }

  startCapture() {
    const sourceSelect = document.getElementById('source-select');
    const interfaceSelect = document.getElementById('interface-select');
    const pcapFile = document.getElementById('pcap-file');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');

    const message = {
      action: 'start'
    };

    if (sourceSelect.value === 'live') {
      message.interface = interfaceSelect.value;
    } else {
      if (!pcapFile.value) {
        alert('Please enter a PCAP file path');
        return;
      }
      message.pcapFile = pcapFile.value;
    }

    this.ws.send(JSON.stringify(message));
    this.isRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;

    this.resetStats();
  }

  stopCapture() {
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');

    this.ws.send(JSON.stringify({ action: 'stop' }));
    this.isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }

  addConnection(connection) {
    this.totalConnections++;
    this.lastSecondCount++;
    
    this.countriesSet.add(connection.source.country);
    this.countriesSet.add(connection.destination.country);

    const srcCoords = connection.source.coordinates;
    const dstCoords = connection.destination.coordinates;

    if (!srcCoords || !dstCoords) {
      return;
    }

    if (this.activeConnections >= this.maxConcurrentConnections) {
      return;
    }

    this.connectionQueue.push(connection);
    this.processConnectionQueue();
  }

  processConnectionQueue() {
    if (this.processingQueue || this.connectionQueue.length === 0) {
      return;
    }

    this.processingQueue = true;

    const connection = this.connectionQueue.shift();
    const srcCoords = connection.source.coordinates;
    const dstCoords = connection.destination.coordinates;

    this.activeConnections++;
    this.updateStats();

    const seriesId = `connection-${this.seriesCounter++}`;
    
    this.chart.addSeries({
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
      color: this.getConnectionColor(connection.protocol),
      lineWidth: 2,
      opacity: 0.8,
      enableMouseTracking: true,
      tooltip: {
        headerFormat: '',
        pointFormat: `
          <b>Connection</b><br/>
          From: ${connection.source.ip}<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;${this.formatLocation(connection.source)}<br/>
          To: ${connection.destination.ip}<br/>
          &nbsp;&nbsp;&nbsp;&nbsp;${this.formatLocation(connection.destination)}<br/>
          Protocol: ${connection.protocol}
        `
      },
      animation: {
        duration: this.animationDuration
      },
      states: {
        hover: {
          lineWidth: 3,
          opacity: 1
        }
      }
    }, false);

    this.scheduleRedraw();

    setTimeout(() => {
      const series = this.chart.get(seriesId);
      
      if (series) {
        series.remove(false);
        this.scheduleRedraw();
      }
      
      this.activeConnections--;
      this.updateStats();
      
      this.processingQueue = false;
      this.processConnectionQueue();
    }, this.animationDuration);

    this.addToFeed(connection);
    
    setTimeout(() => {
      this.processingQueue = false;
      this.processConnectionQueue();
    }, 100);
  }

  scheduleRedraw() {
    if (this.pendingRedraws) {
      return;
    }

    this.pendingRedraws = true;
    requestAnimationFrame(() => {
      this.chart.redraw();
      this.pendingRedraws = false;
    });
  }

  getConnectionColor(protocol) {
    const colors = {
      6: '#00f5ff',
      17: '#00ff88',
      1: '#ff6b6b',
      default: '#ffd700'
    };
    
    return colors[protocol] || colors.default;
  }

  formatLocation(location) {
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
  }

  addToFeed(connection) {
    const feedList = document.getElementById('feed-list');
    const item = document.createElement('div');
    item.className = 'feed-item';
    
    const time = new Date(connection.timestamp).toLocaleTimeString();
    
    item.innerHTML = `
      <div class="feed-item-time">${time}</div>
      <div class="feed-item-route">
        ${this.formatLocation(connection.source)} → ${this.formatLocation(connection.destination)}
      </div>
      <div class="feed-item-details">
        ${connection.source.ip} → ${connection.destination.ip}
      </div>
    `;
    
    feedList.insertBefore(item, feedList.firstChild);
    
    if (feedList.children.length > 50) {
      feedList.removeChild(feedList.lastChild);
    }
  }

  resetStats() {
    this.totalConnections = 0;
    this.activeConnections = 0;
    this.countriesSet.clear();
    this.lastSecondCount = 0;
    this.connectionRate = 0;
    document.getElementById('feed-list').innerHTML = '';
    this.updateStats();
  }

  updateStats() {
    document.getElementById('total-connections').textContent = this.totalConnections;
    document.getElementById('active-connections').textContent = this.activeConnections;
    document.getElementById('countries-count').textContent = this.countriesSet.size;
    document.getElementById('connection-rate').textContent = `${this.connectionRate}/s`;
  }

  startRateCounter() {
    setInterval(() => {
      this.connectionRate = this.lastSecondCount;
      this.lastSecondCount = 0;
      this.updateStats();
    }, 1000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new MapVisualizer();
});
