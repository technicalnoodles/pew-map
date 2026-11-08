import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import Controls from './components/Controls';
import Stats from './components/Stats';
import PixiMapContainer from './components/PixiMapContainer';
import ConnectionFeed from './components/ConnectionFeed';
import Footer from './components/Footer';
import useWebSocket from './hooks/useWebSocket';
import { enqueueVisuals } from './visual-queue.mjs';

const VISUAL_INTERVAL_MS = 100;
const MAX_PENDING_VISUALS = 50;

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [totalConnections, setTotalConnections] = useState(0);
  const [activeConnections, setActiveConnections] = useState(0);
  const [countriesCount, setCountriesCount] = useState(0);
  const [connectionRate, setConnectionRate] = useState(0);
  const [recentConnections, setRecentConnections] = useState([]);
  const [interfaces, setInterfaces] = useState([]);
  const [connectionBatch, setConnectionBatch] = useState([]);
  const [animationDuration, setAnimationDuration] = useState(2000);
  const nextFeedId = useRef(0);
  const pendingVisuals = useRef([]);
  const acceptingVisuals = useRef(true);
  const receivedLastSecond = useRef(0);

  const wsUrl = `ws://${window.location.hostname}:${window.location.port || 3000}`;
  const { sendMessage, lastMessage, connectionStatus } = useWebSocket(wsUrl);

  const handleBatch = useCallback((message) => {
    const batch = message.data || [];
    const count = message.totalCount || batch.length;

    setTotalConnections((prev) => prev + count);
    receivedLastSecond.current += count;
    if (acceptingVisuals.current) {
      pendingVisuals.current = enqueueVisuals(pendingVisuals.current, batch, MAX_PENDING_VISUALS);
    }
  }, []);

  useEffect(() => {
    const rateTimer = setInterval(() => {
      setConnectionRate(receivedLastSecond.current);
      receivedLastSecond.current = 0;
    }, 1000);
    const timer = setInterval(() => {
      const connection = pendingVisuals.current.shift();
      if (!connection) return;
      setConnectionBatch([connection]);
      const feedItem = {
        ...connection,
        _feedId: ++nextFeedId.current,
        _formattedTime: connection._formattedTime || new Date(connection.timestamp).toLocaleTimeString()
      };
      setRecentConnections(prev => [feedItem, ...prev].slice(0, 100));
    }, VISUAL_INTERVAL_MS);
    return () => { clearInterval(timer); clearInterval(rateTimer); };
  }, []);

  useEffect(() => {
    if (connectionStatus === 'connected') {
      sendMessage({ action: 'list-interfaces' });
    }
  }, [connectionStatus, sendMessage]);

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
  }, [lastMessage, handleBatch]);

  const handleStart = (config) => {
    acceptingVisuals.current = true;
    pendingVisuals.current = [];
    receivedLastSecond.current = 0;
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
    acceptingVisuals.current = false;
    pendingVisuals.current = [];
    sendMessage({ action: 'stop' });
    setIsRunning(false);
  };

  return (
    <div className="app">
      <div className="top-bar">
        <Header />
        <Stats
          totalConnections={totalConnections}
          activeConnections={activeConnections}
          countriesCount={countriesCount}
          connectionRate={connectionRate}
        />
      </div>
      
      <Controls
        interfaces={interfaces}
        isRunning={isRunning}
        onStart={handleStart}
        onStop={handleStop}
        animationDuration={animationDuration}
        onAnimationDurationChange={setAnimationDuration}
      />
      
      <div className="viewport">
        <PixiMapContainer
          connectionBatch={connectionBatch}
          isRunning={isRunning}
          animationDuration={animationDuration}
          onActiveConnectionsChange={setActiveConnections}
          onCountriesCountChange={setCountriesCount}
        />
        
        <ConnectionFeed connections={recentConnections} />
      </div>
      
      <Footer />
    </div>
  );
}

export default App;
