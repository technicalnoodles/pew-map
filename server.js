require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const PacketProcessor = require('./lib/packet-processor');
const SyslogProcessor = require('./lib/syslog-processor');

const app = express();
const PORT = process.env.PORT || 3000;

const distPath = path.join(__dirname, 'dist');
const publicPath = path.join(__dirname, 'public');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
} else {
  app.use(express.static(publicPath));
}

app.use(express.json());

const server = app.listen(PORT);

server.setMaxListeners(0);

const wss = new WebSocket.Server({ server });

const packetProcessor = new PacketProcessor();
const syslogProcessor = new SyslogProcessor();

wss.on('connection', (ws) => {
  // Batch buffer: collect connections and flush every 100ms
  // At high volumes, sample to keep payload small
  let connectionBuffer = [];
  let flushInterval = null;
  const MAX_VISUAL_PER_BATCH = 200;

  const startBatching = () => {
    if (flushInterval) return;
    flushInterval = setInterval(() => {
      if (connectionBuffer.length > 0 && ws.readyState === WebSocket.OPEN) {
        const totalCount = connectionBuffer.length;
        let visual;

        if (totalCount <= MAX_VISUAL_PER_BATCH) {
          visual = connectionBuffer;
        } else {
          // Reservoir sampling: pick MAX_VISUAL_PER_BATCH random connections
          visual = connectionBuffer.slice(0, MAX_VISUAL_PER_BATCH);
          for (let i = MAX_VISUAL_PER_BATCH; i < totalCount; i++) {
            const j = Math.floor(Math.random() * (i + 1));
            if (j < MAX_VISUAL_PER_BATCH) {
              visual[j] = connectionBuffer[i];
            }
          }
        }

        ws.send(JSON.stringify({
          type: 'batch',
          data: visual,
          totalCount: totalCount
        }));
        connectionBuffer = [];
      }
    }, 100);
  };

  const stopBatching = () => {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    connectionBuffer = [];
  };

  const onConnection = (connection) => {
    connectionBuffer.push(connection);
  };

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.action === 'start') {
        const { interface: iface, pcapFile, syslogFile, syslogLive, syslogPort } = data;
        startBatching();
        
        if (syslogLive) {
          syslogProcessor.startLive(syslogPort, onConnection);
        } else if (syslogFile) {
          syslogProcessor.startFromFile(syslogFile, onConnection);
        } else if (pcapFile) {
          packetProcessor.startFromFile(pcapFile, onConnection);
        } else {
          packetProcessor.startLiveCapture(iface, onConnection);
        }
      } else if (data.action === 'stop') {
        packetProcessor.stop();
        syslogProcessor.stop();
        stopBatching();
      } else if (data.action === 'list-interfaces') {
        const interfaces = packetProcessor.listInterfaces();
        ws.send(JSON.stringify({ type: 'interfaces', data: interfaces }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    packetProcessor.stop();
    syslogProcessor.stop();
    stopBatching();
  });
});

process.once('SIGINT', () => {
  packetProcessor.stop();
  syslogProcessor.stop();
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});
