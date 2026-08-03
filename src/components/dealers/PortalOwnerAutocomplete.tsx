import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Search, X } from 'lucide-react';

export type PortalOwnerOption = {
  uid: string;
  displayName: string;
  hint?: string;
};

export function PortalOwnerAutocomplete({
  valueUid,
  valueLabel,
  options,
  disabled,
  busy,
  ariaLabel,
  placeholder,
  showClear = true,
  onSelect,
  onClear,
}: {
  valueUid: string;
  valueLabel: string;
  options: PortalOwnerOption[];
  disabled?: boolean;
  busy?: boolean;
  ariaLabel: string;
  placeholder?: string;
  showClear?: boolean;
  onSelect: (uid: string) => void;
  onClear?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? options
      : options.filter(opt =>
        opt.displayName.toLowerCase().includes(q)
        || (opt.hint?.toLowerCase().includes(q) ?? false)
        || opt.uid.toLowerCase().includes(q),
      );
    return list.slice(0, 40);
  }, [options, query]);

  const updateMenuPosition = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, 220);
    const maxH = Math.min(260, window.innerHeight - 24);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < Math.min(maxH, 160) && spaceAbove > spaceBelow;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setMenuStyle({
      position: 'fixed',
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      left,
      width,
      maxHeight: openUp ? Math.min(maxH, spaceAbove) : Math.min(maxH, Math.max(spaceBelow, 120)),
      zIndex: 720,
    });
  };

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.zoho-sp-owner-ac__menu')) return;
      setOpen(false);
      setQuery('');
    };
    const onReposition = () => updateMenuPosition();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const pick = (uid: string) => {
    onSelect(uid);
    setOpen(false);
    setQuery('');
  };

  const showLabel = !open && !query;
  const displayValue = showLabel ? (valueLabel || '') : query;
  const emptyPlaceholder = placeholder
    || (valueUid ? valueLabel || 'Linked owner' : 'Link owner…');

  const menu = open ? (
    <ul
      className="zoho-sp-owner-ac__menu panel glass"
      style={menuStyle}
      role="listbox"
      aria-label={ariaLabel}
    >
      {matches.length === 0 ? (
        <li className="zoho-sp-owner-ac__empty text-muted text-sm">No matching staff</li>
      ) : (
        matches.map((opt, index) => (
          <li key={opt.uid} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={opt.uid === valueUid || index === activeIndex}
              className={[
                'zoho-sp-owner-ac__option',
                opt.uid === valueUid ? 'is-selected' : '',
                index === activeIndex ? 'is-active' : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(opt.uid)}
            >
              <span className="zoho-sp-owner-ac__option-name">{opt.displayName}</span>
              {opt.hint ? (
                <span className="zoho-sp-owner-ac__option-hint">{opt.hint}</span>
              ) : null}
            </button>
          </li>
        ))
      )}
    </ul>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`zoho-sp-owner-ac${open ? ' is-open' : ''}${disabled || busy ? ' is-disabled' : ''}`}
    >
      <Search size={14} className="zoho-sp-owner-ac__icon" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        className="zoho-sp-owner-ac__input"
        value={displayValue}
        disabled={disabled || busy}
        placeholder={emptyPlaceholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
        onFocus={() => {
          if (!disabled && !busy) {
            setOpen(true);
            setQuery('');
            updateMenuPosition();
          }
        }}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={e => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            setOpen(true);
            return;
          }
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(i => Math.min(i + 1, Math.max(matches.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(i => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const row = matches[activeIndex];
            if (row) pick(row.uid);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
            inputRef.current?.blur();
          }
        }}
      />
      {busy ? (
        <RefreshCw size={14} className="spin-icon zoho-sp-owner-ac__busy" aria-hidden />
      ) : valueUid && showClear && onClear && !disabled ? (
        <button
          type="button"
          className="zoho-sp-owner-ac__clear"
          title="Unlink owner"
          aria-label="Unlink owner"
          onClick={e => {
            e.stopPropagation();
            onClear();
          }}
        >
          <X size={14} />
        </button>
      ) : null}
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
