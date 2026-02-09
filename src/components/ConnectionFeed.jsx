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

  const getThreatBadgeClass = (connection) => {
    if (!connection.threatLevel) return '';
    const map = {
      critical: 'threat-critical',
      high: 'threat-high',
      medium: 'threat-medium',
      low: 'threat-low',
      info: 'threat-info'
    };
    return map[connection.threatLevel] || '';
  };

  const getBorderColor = (connection) => {
    if (connection.threatColor) return connection.threatColor;
    return '#00a8ff';
  };

  return (
    <div className="connection-feed">
      <h3>Recent Connections</h3>
      <div id="feed-list">
        {connections.map((connection, index) => (
          <div
            key={`${connection.timestamp}-${index}`}
            className={`feed-item ${connection.mode === 'syslog' ? 'feed-item-syslog' : ''}`}
            style={connection.threatColor ? {
              borderLeftColor: connection.threatColor,
              background: `linear-gradient(90deg, ${connection.threatColor}15, rgba(0,0,0,0.3))`
            } : {}}
          >
            <div className="feed-item-time">
              {new Date(connection.timestamp).toLocaleTimeString()}
            </div>
            <div className="feed-item-route">
              {formatLocation(connection.source)} → {formatLocation(connection.destination)}
            </div>
            <div className="feed-item-details">
              {connection.source.ip} → {connection.destination.ip}
            </div>
            {connection.mode === 'syslog' && (
              <>
                {connection.threatInfo && (
                  <div className="feed-item-threat" style={{ color: connection.threatColor || '#FF006E' }}>
                    {connection.threatInfo}
                  </div>
                )}
                <div className="feed-item-badges">
                  {connection.reputationCategory && (
                    <span className={`threat-badge ${getThreatBadgeClass(connection)}`}>
                      {connection.reputationCategory}
                    </span>
                  )}
                  {connection.priorityId && (
                    <span className={`threat-badge ${getThreatBadgeClass(connection)}`}>
                      Priority {connection.priorityId}
                    </span>
                  )}
                  {connection.ruleAction && (
                    <span className="threat-badge threat-action">
                      {connection.ruleAction}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
