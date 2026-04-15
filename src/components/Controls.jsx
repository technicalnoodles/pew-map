import React, { useState } from 'react';

export default function Controls({ interfaces, isRunning, onStart, onStop, animationDuration, onAnimationDurationChange }) {
  const [sourceType, setSourceType] = useState('live');
  const [selectedInterface, setSelectedInterface] = useState('');
  const [pcapFile, setPcapFile] = useState('');
  const [syslogFile, setSyslogFile] = useState('');
  const [syslogPort, setSyslogPort] = useState(514);

  const handleStart = () => {
    const config = {};
    
    if (sourceType === 'live') {
      config.interface = selectedInterface;
    } else if (sourceType === 'file') {
      if (!pcapFile) {
        alert('Please enter a PCAP file path');
        return;
      }
      config.pcapFile = pcapFile;
    } else if (sourceType === 'syslog') {
      if (!syslogFile) {
        alert('Please enter a syslog JSON file path');
        return;
      }
      config.syslogFile = syslogFile;
    } else if (sourceType === 'syslog-live') {
      config.syslogLive = true;
      config.syslogPort = syslogPort;
    }
    
    onStart(config);
  };

  return (
    <div className="controls">
      <div className="control-group">
        <label htmlFor="source-select">Data Source:</label>
        <select
          id="source-select"
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
        >
          <option value="live">Live Capture</option>
          <option value="file">PCAP File</option>
          <option value="syslog">Syslog File (IPS/SI)</option>
          <option value="syslog-live">Live Syslog Receiver (IPS/SI)</option>
        </select>
      </div>

      {sourceType === 'live' && (
        <div className="control-group" id="interface-group">
          <label htmlFor="interface-select">Network Interface:</label>
          <select
            id="interface-select"
            value={selectedInterface}
            onChange={(e) => setSelectedInterface(e.target.value)}
          >
            {interfaces.length === 0 ? (
              <option value="">Loading...</option>
            ) : (
              interfaces.map((iface) => (
                <option key={iface.name} value={iface.name}>
                  {iface.description || iface.name}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      {sourceType === 'file' && (
        <div className="control-group" id="file-group">
          <label htmlFor="pcap-file">PCAP File Path:</label>
          <input
            type="text"
            id="pcap-file"
            value={pcapFile}
            onChange={(e) => setPcapFile(e.target.value)}
            placeholder="/path/to/capture.pcap"
          />
        </div>
      )}

      {sourceType === 'syslog' && (
        <div className="control-group" id="syslog-group">
          <label htmlFor="syslog-file">Syslog JSON File Path:</label>
          <input
            type="text"
            id="syslog-file"
            value={syslogFile}
            onChange={(e) => setSyslogFile(e.target.value)}
            placeholder="/path/to/syslogs.json"
          />
        </div>
      )}

      {sourceType === 'syslog-live' && (
        <div className="control-group" id="syslog-live-group">
          <label htmlFor="syslog-port">Syslog Listen Port (UDP+TCP):</label>
          <input
            type="number"
            id="syslog-port"
            value={syslogPort}
            onChange={(e) => setSyslogPort(parseInt(e.target.value, 10))}
            min="1"
            max="65535"
          />
        </div>
      )}

      <div className="control-group">
        <label htmlFor="animation-duration">Animation Duration (ms):</label>
        <input
          type="number"
          id="animation-duration"
          value={animationDuration}
          onChange={(e) => onAnimationDurationChange(parseInt(e.target.value, 10))}
          min="500"
          max="10000"
          step="100"
        />
      </div>

      <div className="control-group">
        <button
          className="btn btn-primary"
          onClick={handleStart}
          disabled={isRunning}
        >
          Start Capture
        </button>
        <button
          className="btn btn-danger"
          onClick={onStop}
          disabled={!isRunning}
        >
          Stop Capture
        </button>
      </div>
    </div>
  );
}
