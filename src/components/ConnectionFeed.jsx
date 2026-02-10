import React, { useRef, useEffect } from 'react';

const THREAT_BADGE_MAP = {
  critical: 'threat-critical',
  high: 'threat-high',
  medium: 'threat-medium',
  low: 'threat-low',
  info: 'threat-info'
};

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
  return THREAT_BADGE_MAP[connection.threatLevel] || '';
};

const FeedItem = React.memo(function FeedItem({ connection }) {
  return (
    <div
      className={`feed-item ${connection.mode === 'syslog' ? 'feed-item-syslog' : ''}`}
      style={connection.threatColor ? {
        borderLeftColor: connection.threatColor,
        background: `linear-gradient(90deg, ${connection.threatColor}15, rgba(0,0,0,0.3))`
      } : undefined}
    >
      <div className="feed-item-time">
        {connection._formattedTime}
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
  );
});

export default function ConnectionFeed({ connections }) {
  const feedRef = useRef(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;

    const newItems = connections.length - prevCountRef.current;
    prevCountRef.current = connections.length;

    // If user has scrolled away from the top, preserve their position
    if (newItems > 0 && el.scrollTop > 0) {
      const prevScrollHeight = el.scrollHeight;
      requestAnimationFrame(() => {
        el.scrollTop += el.scrollHeight - prevScrollHeight;
      });
    }
  }, [connections]);

  return (
    <div className="connection-feed">
      <h3>Recent Connections</h3>
      <div id="feed-list" ref={feedRef}>
        {connections.map((connection, index) => (
          <FeedItem
            key={`${connection.timestamp}-${index}`}
            connection={connection}
          />
        ))}
      </div>
    </div>
  );
}
