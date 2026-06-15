import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DealerStatusMeta } from '../../lib/dealerStatus';
import { getStageOptionsForSignedIn } from '../../lib/dealerStatus';
import { DealerStatusBadge } from './DealerStatusBadge';

interface DealerStatusPickerProps {
  meta: DealerStatusMeta;
  signedIn: boolean;
  stage: string | null | undefined;
  onStageChange: (stage: string | null) => void;
  ariaLabel: string;
}

export const DealerStatusPicker: React.FC<DealerStatusPickerProps> = ({
  meta,
  signedIn,
  stage,
  onStageChange,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const options = getStageOptionsForSignedIn(signedIn);
  const currentValue = stage ?? '';

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      zIndex: 200,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.dealers-status-picker__menu')) return;
      setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    const onReposition = () => updateMenuPosition();

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const menu = open ? (
    <div
      className="dealers-status-picker__menu panel glass"
      style={menuStyle}
      role="listbox"
      aria-label={ariaLabel}
    >
      {options.map(opt => {
        const selected = opt.value === currentValue;
        return (
          <button
            key={opt.key}
            type="button"
            role="option"
            aria-selected={selected}
            className={`dealers-status-picker__option${selected ? ' dealers-status-picker__option--selected' : ''}`}
            title={opt.title}
            onClick={() => {
              onStageChange(opt.value || null);
              setOpen(false);
            }}
          >
            <DealerStatusBadge meta={opt.meta} />
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="dealers-status-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`dealers-status-picker__trigger ${meta.badgeClass}`}
        onClick={() => setOpen(v => !v)}
        aria-label={ariaLabel}
        title={meta.label}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="dealers-status-badge__symbol" aria-hidden>{meta.symbol}</span>
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
};
