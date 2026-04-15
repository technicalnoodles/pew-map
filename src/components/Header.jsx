import React from 'react';

export default React.memo(function Header() {
  return (
    <div className="top-bar-title">
      <h1>Pew Map</h1>
      <span className="author">by Ryan MacLennan</span>
    </div>
  );
});
