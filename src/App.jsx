import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import Controls from './components/Controls';
import Stats from './components/Stats';
import PixiMapContainer from './components/PixiMapContainer';
import ConnectionFeed from './components/ConnectionFeed';
import Footer from './components/Footer';
import useWebSocket from './hooks/useWebSocket';

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [totalConnections, setTotalConnections] = useState(0);
  const [activeConnections, setActiveConnections] = useState(0);
  const [countriesCount, setCountriesCount] = useState(0);
  const [connectionRate, setConnectionRate] = useState(0);
  const [recentConnections, setRecentConnections] = useState([]);
  const [interfaces, setInterfaces] = useState([]);
  const [connectionBatch, setConnectionBatch] = useState([]);

  const { sendMessage, lastMessage, connectionStatus } = useWebSocket(
    'ws://localhost:3000'
  );

  useEffect(() => {
    if (connectionStatus === 'connected') {
      sendMessage({ action: 'list-interfaces' });
    }
  }, [connectionStatus]);

  useEffect(() => {
    if (lastMessage) {
      if (lastMessage.type === 'interfaces') {
        setInterfaces(lastMessage.data);
      } else if (lastMessage.type === 'batch') {
        handleBatch(lastMessage);
      } else if (lastMessage.type === 'connection') {
        handleBatch({ data: [lastMessage], totalCount: 1 });
      }
    }
  }, [lastMessage]);

  const handleBatch = useCallback((message) => {
    const batch = message.data || [];
    const count = message.totalCount || batch.length;

    setTotalConnections((prev) => prev + count);
    setConnectionBatch(batch);

    setRecentConnections((prev) => {
      const updated = [...batch.reverse(), ...prev];
      return updated.slice(0, 100);
    });
  }, []);

  const handleStart = (config) => {
    sendMessage({
      action: 'start',
      ...config
    });
    setIsRunning(true);
    setTotalConnections(0);
    setActiveConnections(0);
    setCountriesCount(0);
    setConnectionRate(0);
    setRecentConnections([]);
  };

  const handleStop = () => {
    sendMessage({ action: 'stop' });
    setIsRunning(false);
  };

  return (
    <div className="container">
      <Header />
      
      <Controls
        interfaces={interfaces}
        isRunning={isRunning}
        onStart={handleStart}
        onStop={handleStop}
      />
      
      <Stats
        totalConnections={totalConnections}
        activeConnections={activeConnections}
        countriesCount={countriesCount}
        connectionRate={connectionRate}
      />
      
      <div className="map-and-feed">
        <PixiMapContainer
          connectionBatch={connectionBatch}
          onActiveConnectionsChange={setActiveConnections}
          onCountriesCountChange={setCountriesCount}
          onConnectionRateChange={setConnectionRate}
        />
        
        <ConnectionFeed connections={recentConnections} />
      </div>
      
      <Footer />
    </div>
  );
}

export default App;
