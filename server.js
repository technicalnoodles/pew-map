require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const PacketProcessor = require('./lib/packet-processor');
const SyslogProcessor = require('./lib/syslog-processor');
const { PaloAltoThreatProcessor } = require('./lib/palo-alto-processor');
const { resolveCaptureSource, startCaptureSource } = require('./lib/capture-source');
const { addConnectionToClientBatch, drainClientBatch } = require('./lib/client-batch');
const logger = require('./lib/logger')('Server');

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

const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});

server.setMaxListeners(20);

const wss = new WebSocket.Server({ server });

const packetProcessor = new PacketProcessor();
const syslogProcessor = new SyslogProcessor();
const paloAltoProcessor = new PaloAltoThreatProcessor();

// --- Shared broadcast infrastructure for multi-client support ---
const MAX_VISUAL_PER_BATCH = 200;
const clients = new Map(); // ws -> { buffer, totalCount, flushInterval }
let connectionIdCounter = 0;

const broadcastConnection = (connection) => {
  connection.id = ++connectionIdCounter;
  for (const [, client] of clients) {
    addConnectionToClientBatch(client, connection, MAX_VISUAL_PER_BATCH);
  }
};

const startClientBatching = (ws) => {
  const client = clients.get(ws);
  if (!client || client.flushInterval) return;

  client.flushInterval = setInterval(() => {
    if (client.totalCount > 0 && ws.readyState === WebSocket.OPEN) {
      const { totalCount, visual } = drainClientBatch(client);
      ws.send(JSON.stringify({
        type: 'batch',
        data: visual,
        totalCount: totalCount
      }));
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
  client.totalCount = 0;
};

const removeClient = (ws) => {
  stopClientBatching(ws);
  clients.delete(ws);

  // Stop capture only when no clients remain
  if (clients.size === 0) {
    packetProcessor.stop();
    syslogProcessor.stop();
    paloAltoProcessor.stop();
  }
};

const startCapture = (config) => {
  const source = resolveCaptureSource(config);

  // Start batching for all connected clients
  for (const [clientWs] of clients) {
    startClientBatching(clientWs);
  }

  switch (source.type) {
    case 'syslog-live':
      logger.info(`Starting live FTD syslog capture on port ${source.port}`);
      break;
    case 'syslog-file':
      logger.info(`Starting FTD syslog file replay: ${source.filePath}`);
      break;
    case 'palo-alto-file':
      logger.info(`Starting Palo Alto Threat CSV replay: ${source.filePath}`);
      break;
    case 'pcap-file':
      logger.info(`Starting PCAP file replay: ${source.filePath}`);
      break;
    default:
      logger.info(`Starting live packet capture on interface: ${source.interface || 'default'}`);
  }

  startCaptureSource(source, {
    packetProcessor,
    syslogProcessor,
    paloAltoProcessor
  }, broadcastConnection);
};

const stopCapture = () => {
  logger.info('Stopping capture');
  packetProcessor.stop();
  syslogProcessor.stop();
  paloAltoProcessor.stop();
  for (const [clientWs] of clients) {
    stopClientBatching(clientWs);
  }
};

wss.on('connection', (ws) => {
  logger.info(`WebSocket client connected (total: ${clients.size + 1})`);
  clients.set(ws, { buffer: [], totalCount: 0, flushInterval: null });

  // If capture is already running, start batching for this new client immediately
  if (packetProcessor.isRunning || syslogProcessor.isRunning || paloAltoProcessor.isRunning) {
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
      logger.error('Error handling WebSocket message', err.message);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    logger.info(`WebSocket client disconnected (remaining: ${clients.size - 1})`);
    removeClient(ws);
  });
});

process.once('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  packetProcessor.stop();
  syslogProcessor.stop();
  paloAltoProcessor.stop();
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});
