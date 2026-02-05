import React from 'react';

export default function ConnectionFeed({ connections }) {
  const formatLocation = (location) => {
    const parts = [];
    
    if (location.city && location.city !== 'Unknown') {
      parts.push(location.city);
    }
    
    if (location.region) {
      parts.push(location.region);
    }
    
    if (location.country && location.country !== 'Unknown') {
      parts.push(location.country);
    }
    
    return parts.length > 0 ? parts.join(', ') : 'Unknown';
  };

  return (
    <div className="connection-feed">
      <h3>Recent Connections</h3>
      <div id="feed-list">
        {connections.map((connection, index) => (
          <div key={`${connection.timestamp}-${index}`} className="feed-item">
            <div className="feed-item-time">
              {new Date(connection.timestamp).toLocaleTimeString()}
            </div>
            <div className="feed-item-route">
              {formatLocation(connection.source)} → {formatLocation(connection.destination)}
            </div>
            <div className="feed-item-details">
              {connection.source.ip} → {connection.destination.ip}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
