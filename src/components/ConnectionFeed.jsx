import React, { useRef, useLayoutEffect } from 'react';

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
  const isThreatLog = connection.mode === 'syslog' || connection.mode === 'palo-alto';
  const threatStyle = connection.threatColor ? {
    background: `color-mix(in oklch, ${connection.threatColor} 8%, transparent)`
  } : undefined;

  return (
    <div
      data-feed-id={connection._feedId}
      className={`feed-item ${isThreatLog ? 'feed-item-syslog' : ''}`}
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
      {isThreatLog && (
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
  const previousPositions = useRef(new Map());
  const wasReading = useRef(false);

  useLayoutEffect(() => {
    const list = feedRef.current;
    if (!list) return;
    const positions = previousPositions.current;
    const items = Array.from(list.children);
    const listRect = list.getBoundingClientRect();
    const anchor = wasReading.current && items.find(item => positions.has(item.dataset.feedId));
    if (anchor) {
      list.scrollTop += anchor.getBoundingClientRect().top - positions.get(anchor.dataset.feedId);
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!wasReading.current && !reducedMotion && positions.size) {
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        if (rect.top > listRect.bottom || rect.bottom < listRect.top) continue;
        const previousTop = positions.get(item.dataset.feedId);
        if (previousTop != null) {
          const delta = previousTop - rect.top;
          if (Math.abs(delta) > 0.5) {
            item.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
              { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
          }
        } else {
          item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
        }
      }
    }

    return () => {
      wasReading.current = list.scrollTop > 1;
      const bounds = list.getBoundingClientRect();
      const nextPositions = new Map();
      for (const item of list.children) {
        const rect = item.getBoundingClientRect();
        if (rect.bottom >= bounds.top && rect.top <= bounds.bottom) {
          nextPositions.set(item.dataset.feedId, rect.top);
        }
        for (const animation of item.getAnimations()) animation.cancel();
      }
      previousPositions.current = nextPositions;
    };
  }, [connections]);

  return (
    <div className="connection-feed">
      <div className="feed-header">
        <h3>Live Feed</h3>
      </div>
      <div id="feed-list" ref={feedRef} aria-live="polite" aria-relevant="additions">
        {connections.map((connection) => (
          <FeedItem
            key={connection._feedId}
            connection={connection}
          />
        ))}
      </div>
    </div>
  );
}
