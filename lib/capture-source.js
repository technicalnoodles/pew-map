function resolveCaptureSource(config) {
  if (config.syslogLive) {
    return { type: 'syslog-live', port: config.syslogPort };
  }

  if (config.syslogFile) {
    return { type: 'syslog-file', filePath: config.syslogFile };
  }

  if (config.paloAltoFile) {
    return { type: 'palo-alto-file', filePath: config.paloAltoFile };
  }

  if (config.pcapFile) {
    return { type: 'pcap-file', filePath: config.pcapFile };
  }

  return { type: 'live-capture', interface: config.interface };
}

function startCaptureSource(source, processors, callback) {
  const { packetProcessor, syslogProcessor, paloAltoProcessor } = processors;

  switch (source.type) {
    case 'syslog-live':
      syslogProcessor.startLive(source.port, callback);
      break;
    case 'syslog-file':
      syslogProcessor.startFromFile(source.filePath, callback);
      break;
    case 'palo-alto-file':
      paloAltoProcessor.startFromFile(source.filePath, callback);
      break;
    case 'pcap-file':
      packetProcessor.startFromFile(source.filePath, callback);
      break;
    case 'live-capture':
      packetProcessor.startLiveCapture(source.interface, callback);
      break;
    default:
      throw new Error(`Unsupported capture source: ${source.type}`);
  }
}

module.exports = { resolveCaptureSource, startCaptureSource };
