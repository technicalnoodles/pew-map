import React from 'react';

export default React.memo(function Stats({ totalConnections, activeConnections, countriesCount, connectionRate }) {
  return (
    <div className="stats">
      <div className="stat-card">
        <div className="stat-value">{totalConnections}</div>
        <div className="stat-label">Total Connections</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{activeConnections}</div>
        <div className="stat-label">Active Lines</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{countriesCount}</div>
        <div className="stat-label">Countries</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{connectionRate}/s</div>
        <div className="stat-label">Rate</div>
      </div>
    </div>
  );
});
