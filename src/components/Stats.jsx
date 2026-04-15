import React from 'react';

export default React.memo(function Stats({ totalConnections, activeConnections, countriesCount, connectionRate }) {
  return (
    <div className="stats-inline">
      <div className="stat-item">
        <span className="stat-value">{totalConnections}</span>
        <span className="stat-label">Connections</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{activeConnections}</span>
        <span className="stat-label">Active</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{countriesCount}</span>
        <span className="stat-label">Countries</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{connectionRate}/s</span>
        <span className="stat-label">Rate</span>
      </div>
    </div>
  );
});
