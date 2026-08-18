import React from 'react';

/** Clock-style countdown ring shown on Verify & invoice while Zoho creates the invoice. */
export const VerifyInvoiceClock: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg
    className="so-verify-clock"
    width={size}
    height={size}
    viewBox="0 0 32 32"
    aria-hidden
  >
    <circle className="so-verify-clock__track" cx="16" cy="16" r="13" />
    <circle className="so-verify-clock__ring" cx="16" cy="16" r="13" />
    <line className="so-verify-clock__hand" x1="16" y1="16" x2="16" y2="7" />
    <circle className="so-verify-clock__hub" cx="16" cy="16" r="1.7" />
  </svg>
);
