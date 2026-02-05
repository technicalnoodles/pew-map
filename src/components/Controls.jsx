import React, { useState } from 'react';

export default function Controls({ interfaces, isRunning, onStart, onStop }) {
  const [sourceType, setSourceType] = useState('live');
  const [selectedInterface, setSelectedInterface] = useState('');
  const [pcapFile, setPcapFile] = useState('');
  const [animationDuration, setAnimationDuration] = useState(2000);

  const handleStart = () => {
    const config = {};
    
    if (sourceType === 'live') {
      config.interface = selectedInterface;
    } else {
      if (!pcapFile) {
        alert('Please enter a PCAP file path');
        return;
      }
      config.pcapFile = pcapFile;
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
        </select>
      </div>

      {sourceType === 'live' ? (
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
      ) : (
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

      <div className="control-group">
        <label htmlFor="animation-duration">Animation Duration (ms):</label>
        <input
          type="number"
          id="animation-duration"
          value={animationDuration}
          onChange={(e) => setAnimationDuration(parseInt(e.target.value))}
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
