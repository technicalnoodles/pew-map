import React from 'react';

export default React.memo(function Footer() {
  return (
    <footer>
      <p>⚠️ Requires root/admin privileges for live packet capture</p>
      <p>Created By: Ryan MacLennan</p>
    </footer>
  );
});
