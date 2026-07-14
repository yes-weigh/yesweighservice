import React, { useState } from 'react';
import { QrCode } from 'lucide-react';
import { SpareSkuQrScanner } from './SpareSkuQrScanner';

export interface SkuScanButtonProps {
  /** Return true to close the scanner (scan accepted). */
  onScan: (value: string) => boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  hint?: string;
  missMessage?: string;
  ariaLabel?: string;
  scannerTitle?: string;
}

/** Compact QR button that opens the shared SKU scanner overlay. */
export const SkuScanButton: React.FC<SkuScanButtonProps> = ({
  onScan,
  disabled = false,
  className = '',
  title = 'Scan QR',
  hint = 'Point at the label QR code.',
  missMessage = 'Not found',
  ariaLabel = 'Scan SKU QR code',
  scannerTitle = 'Scan QR',
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={[
          'sku-scan-btn',
          open ? 'is-open' : '',
          className,
        ].filter(Boolean).join(' ')}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
      >
        <QrCode size={18} strokeWidth={2.25} aria-hidden />
      </button>
      {open && (
        <SpareSkuQrScanner
          title={scannerTitle}
          hint={hint}
          missMessage={missMessage}
          ariaLabel={ariaLabel}
          onClose={() => setOpen(false)}
          onDetected={value => {
            const accepted = onScan(value);
            if (accepted) setOpen(false);
            return accepted;
          }}
        />
      )}
    </>
  );
};

/** Accept any non-empty scan and write it into a search field. */
export function fillSearchFromScan(
  raw: string,
  setSearch: (value: string) => void,
): boolean {
  const value = raw.trim();
  if (!value) return false;
  setSearch(value);
  return true;
}

/** Match a catalog item by exact SKU or product id (case-insensitive). */
export function matchCatalogByScan<T extends { id: string; sku?: string | null }>(
  raw: string,
  items: T[],
): T | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  return items.find(item => {
    const sku = item.sku?.trim().toLowerCase();
    if (sku && sku === normalized) return true;
    return item.id.trim().toLowerCase() === normalized;
  }) ?? null;
}
