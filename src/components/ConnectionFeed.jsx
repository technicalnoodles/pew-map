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

const obfuscateIP = (ip) => {
  if (!ip) return 'Unknown';
  if (ip.includes(':')) {
    // IPv6: hide last 4 groups
    const groups = ip.split(':');
    const half = Math.ceil(groups.length / 2);
    return groups.slice(0, half).join(':') + ':' + groups.slice(half).map(() => 'x').join(':');
  }
  // IPv4: hide last 2 octets
  const octets = ip.split('.');
  return octets[0] + '.' + octets[1] + '.x.x';
};

const getThreatBadgeClass = (connection) => {
  if (!connection.threatLevel) return '';
  return THREAT_BADGE_MAP[connection.threatLevel] || '';
};

const FeedItem = React.memo(function FeedItem({ connection }) {
  const isSyslog = connection.mode === 'syslog';
  const threatStyle = connection.threatColor ? {
    background: `color-mix(in oklch, ${connection.threatColor} 8%, transparent)`
  } : undefined;

  return (
    <div
      className={`feed-item ${isSyslog ? 'feed-item-syslog' : ''}`}
      style={threatStyle}
    >
      <div className="feed-item-time">
        {connection._formattedTime}
      </div>
      <div className="feed-item-route">
        {formatLocation(connection.source)} → {formatLocation(connection.destination)}
      </div>
      <div className="feed-item-details">
        {obfuscateIP(connection.source.ip)} → {obfuscateIP(connection.destination.ip)}
      </div>
      {isSyslog && (
        <>
          {connection.threatInfo && (
            <div className="feed-item-threat" style={{ color: connection.threatColor }}>
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
  const prevFirstTimestamp = useRef(null);

  useEffect(() => {
    const el = feedRef.current;
    if (!el || connections.length === 0) return;

    const currentFirst = connections[0]?.timestamp;
    const hasNewData = currentFirst !== prevFirstTimestamp.current;
    prevFirstTimestamp.current = currentFirst;

    // If user has scrolled away from the top, preserve their position
    if (hasNewData && el.scrollTop > 0) {
      const prevScrollHeight = el.scrollHeight;
      requestAnimationFrame(() => {
        el.scrollTop += el.scrollHeight - prevScrollHeight;
      });
    }
  }, [connections]);

  return (
    <div className="connection-feed">
      <div className="feed-header">
        <h3>Live Feed</h3>
      </div>
      <div id="feed-list" ref={feedRef} aria-live="polite" aria-relevant="additions">
        {connections.map((connection, index) => (
          <FeedItem
            key={connection.id || `${connection.timestamp}-${index}`}
            connection={connection}
          />
        ))}
      </div>
    </div>
  );
}
