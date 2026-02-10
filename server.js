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

// --- Shared broadcast infrastructure for multi-client support ---
const MAX_VISUAL_PER_BATCH = 200;
const clients = new Map(); // ws -> { buffer, flushInterval }

const broadcastConnection = (connection) => {
  for (const [, client] of clients) {
    client.buffer.push(connection);
  }
};

const startClientBatching = (ws) => {
  const client = clients.get(ws);
  if (!client || client.flushInterval) return;

  client.flushInterval = setInterval(() => {
    if (client.buffer.length > 0 && ws.readyState === WebSocket.OPEN) {
      const totalCount = client.buffer.length;
      let visual;

      if (totalCount <= MAX_VISUAL_PER_BATCH) {
        visual = client.buffer;
      } else {
        // Reservoir sampling: pick MAX_VISUAL_PER_BATCH random connections
        visual = client.buffer.slice(0, MAX_VISUAL_PER_BATCH);
        for (let i = MAX_VISUAL_PER_BATCH; i < totalCount; i++) {
          const j = Math.floor(Math.random() * (i + 1));
          if (j < MAX_VISUAL_PER_BATCH) {
            visual[j] = client.buffer[i];
          }
        }
      }

      ws.send(JSON.stringify({
        type: 'batch',
        data: visual,
        totalCount: totalCount
      }));
      client.buffer = [];
    }
  }, 100);
};

const stopClientBatching = (ws) => {
  const client = clients.get(ws);
  if (!client) return;
  if (client.flushInterval) {
    clearInterval(client.flushInterval);
    client.flushInterval = null;
  }
  client.buffer = [];
};

const removeClient = (ws) => {
  stopClientBatching(ws);
  clients.delete(ws);

  // Stop capture only when no clients remain
  if (clients.size === 0) {
    packetProcessor.stop();
    syslogProcessor.stop();
  }
};

const startCapture = (config) => {
  const { interface: iface, pcapFile, syslogFile, syslogLive, syslogPort } = config;

  // Start batching for all connected clients
  for (const [clientWs] of clients) {
    startClientBatching(clientWs);
  }

  if (syslogLive) {
    syslogProcessor.startLive(syslogPort, broadcastConnection);
  } else if (syslogFile) {
    syslogProcessor.startFromFile(syslogFile, broadcastConnection);
  } else if (pcapFile) {
    packetProcessor.startFromFile(pcapFile, broadcastConnection);
  } else {
    packetProcessor.startLiveCapture(iface, broadcastConnection);
  }
};

const stopCapture = () => {
  packetProcessor.stop();
  syslogProcessor.stop();
  for (const [clientWs] of clients) {
    stopClientBatching(clientWs);
  }
};

wss.on('connection', (ws) => {
  clients.set(ws, { buffer: [], flushInterval: null });

  // If capture is already running, start batching for this new client immediately
  if (packetProcessor.isRunning || syslogProcessor.isRunning) {
    startClientBatching(ws);
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.action === 'start') {
        startCapture(data);
      } else if (data.action === 'stop') {
        stopCapture();
      } else if (data.action === 'list-interfaces') {
        const interfaces = packetProcessor.listInterfaces();
        ws.send(JSON.stringify({ type: 'interfaces', data: interfaces }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    removeClient(ws);
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
