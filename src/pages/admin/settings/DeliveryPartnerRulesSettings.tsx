import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { DELIVERY_METHODS } from '../../../constants/deliveryMethods';
import {
  CONFIGURABLE_DELIVERY_PARTNER_IDS,
  LOGISTICS_DESTINATION_REGIONS,
  LOGISTICS_DESTINATION_REGION_LABELS,
  DEFAULT_LOGISTICS_DELIVERY_RULES,
  rulePartnerShortLabel,
} from '../../../constants/logisticsDeliveryRules';
import {
  logisticsPartnerLabel,
  type LogisticsPartnerId,
} from '../../../constants/logisticsPartners';
import {
  deliveryRulesEqual,
  patchDeliveryRuleCell,
} from '../../../lib/logisticsDeliveryRules';
import { saveLogisticsDeliveryRules } from '../../../lib/logisticsSettings';
import type { LogisticsDeliveryRulesMatrix, LogisticsDestinationRegion } from '../../../types/logistics-delivery-rules';
import {
  STAFF_LOGISTICS_SITES,
  STAFF_LOGISTICS_SITE_LABELS,
  type StaffLogisticsSite,
} from '../../../types/staff-logistics';

type DeliveryPartnerRulesSettingsProps = {
  rules: LogisticsDeliveryRulesMatrix;
  onSaved: (next: LogisticsDeliveryRulesMatrix) => void;
  onError: (message: string) => void;
  updatedBy?: string | null;
};

type OpenCell = {
  region: LogisticsDestinationRegion;
  site: StaffLogisticsSite;
};

const PARTNER_IMAGES = Object.fromEntries(
  DELIVERY_METHODS.map(method => [method.id, method.image]),
) as Record<LogisticsPartnerId, string>;

function movePartner(
  partners: LogisticsPartnerId[],
  index: number,
  direction: -1 | 1,
): LogisticsPartnerId[] {
  const next = [...partners];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function replacePartnerAt(
  partners: LogisticsPartnerId[],
  index: number,
  nextId: LogisticsPartnerId,
): LogisticsPartnerId[] {
  if (partners[index] === nextId) return partners;
  if (partners.includes(nextId)) return partners;
  const next = [...partners];
  next[index] = nextId;
  return next;
}

type RuleCellProps = {
  region: LogisticsDestinationRegion;
  site: StaffLogisticsSite;
  partners: LogisticsPartnerId[];
  busy: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (partners: LogisticsPartnerId[]) => void;
};

const RuleCell: React.FC<RuleCellProps> = ({
  region,
  site,
  partners,
  busy,
  isOpen,
  onOpen,
  onClose,
  onChange,
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);

  const unusedPartners = useMemo(
    () => CONFIGURABLE_DELIVERY_PARTNER_IDS.filter(id => !partners.includes(id)),
    [partners],
  );

  const cellLabel = `${LOGISTICS_DESTINATION_REGION_LABELS[region]} · ${STAFF_LOGISTICS_SITE_LABELS[site]}`;

  const reposition = useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const popoverWidth = Math.min(340, window.innerWidth - 24);
    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12));
    let top = rect.bottom + 8;
    const estimatedHeight = 320;
    if (top + estimatedHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - estimatedHeight - 8);
    }
    setAnchor({ top, left, width: popoverWidth });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setAnchor(null);
      return;
    }
    reposition();
    const onScrollOrResize = () => reposition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [isOpen, reposition, partners.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      onClose();
    };
    window.setTimeout(() => {
      document.addEventListener('mousedown', onPointerDown);
    }, 0);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, onClose]);

  const replaceOptionsFor = (index: number) => CONFIGURABLE_DELIVERY_PARTNER_IDS.filter(
    id => id === partners[index] || !partners.includes(id),
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`settings-logistics__rule-trigger${isOpen ? ' is-open' : ''}${partners.length === 0 ? ' is-empty' : ''}`}
        disabled={busy}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => (isOpen ? onClose() : onOpen())}
      >
        {partners.length === 0 ? (
          <span className="settings-logistics__rule-trigger-empty">
            <Plus size={14} aria-hidden />
            Choose partners
          </span>
        ) : (
          <span className="settings-logistics__rule-trigger-flow">
            {partners.map((partnerId, index) => (
              <React.Fragment key={partnerId}>
                {index > 0 && <ChevronRight size={12} className="settings-logistics__rule-trigger-sep" aria-hidden />}
                <span className="settings-logistics__rule-trigger-pill">
                  <em>{index + 1}</em>
                  {rulePartnerShortLabel(partnerId)}
                </span>
              </React.Fragment>
            ))}
          </span>
        )}
        <Pencil size={13} className="settings-logistics__rule-trigger-edit" aria-hidden />
      </button>

      {isOpen && anchor && createPortal(
        <>
          <div className="settings-logistics__rule-backdrop" aria-hidden />
          <div
            ref={popoverRef}
            className="settings-logistics__rule-popover"
            role="dialog"
            aria-label={`Edit partners for ${cellLabel}`}
            style={{
              top: anchor.top,
              left: anchor.left,
              width: anchor.width,
            }}
          >
            <header className="settings-logistics__rule-popover-head">
              <div>
                <strong>{cellLabel}</strong>
                <p>First = primary · tap a partner below to add</p>
              </div>
              <button
                type="button"
                className="settings-logistics__rule-popover-close"
                aria-label="Close"
                onClick={onClose}
              >
                <X size={16} aria-hidden />
              </button>
            </header>

            <div className="settings-logistics__rule-popover-body">
              {partners.length === 0 ? (
                <p className="settings-logistics__rule-popover-empty text-muted text-sm">
                  No partners yet — pick one below.
                </p>
              ) : (
                <ol className="settings-logistics__rule-stack">
                  {partners.map((partnerId, index) => (
                    <li key={`${partnerId}-${index}`} className="settings-logistics__rule-stack-row">
                      <span className="settings-logistics__rule-stack-rank">{index + 1}</span>
                      {PARTNER_IMAGES[partnerId] && (
                        <img
                          src={PARTNER_IMAGES[partnerId]}
                          alt=""
                          className="settings-logistics__rule-stack-logo"
                        />
                      )}
                      <select
                        className="settings-logistics__rule-stack-select"
                        value={partnerId}
                        disabled={busy}
                        aria-label={`Partner ${index + 1}`}
                        onChange={event => {
                          const nextId = event.target.value as LogisticsPartnerId;
                          onChange(replacePartnerAt(partners, index, nextId));
                        }}
                      >
                        {replaceOptionsFor(index).map(optionId => (
                          <option key={optionId} value={optionId}>
                            {logisticsPartnerLabel(optionId)}
                          </option>
                        ))}
                      </select>
                      <div className="settings-logistics__rule-stack-actions">
                        <button
                          type="button"
                          className="settings-logistics__rule-stack-btn"
                          disabled={busy || index === 0}
                          aria-label="Move up"
                          onClick={() => onChange(movePartner(partners, index, -1))}
                        >
                          <ArrowUp size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="settings-logistics__rule-stack-btn"
                          disabled={busy || index === partners.length - 1}
                          aria-label="Move down"
                          onClick={() => onChange(movePartner(partners, index, 1))}
                        >
                          <ArrowDown size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="settings-logistics__rule-stack-btn settings-logistics__rule-stack-btn--danger"
                          disabled={busy}
                          aria-label="Remove"
                          onClick={() => onChange(partners.filter(id => id !== partnerId))}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {unusedPartners.length > 0 && (
                <div className="settings-logistics__rule-add-panel">
                  <span className="settings-logistics__rule-add-label">Add partner</span>
                  <div className="settings-logistics__rule-add-grid">
                    {unusedPartners.map(partnerId => (
                      <button
                        key={partnerId}
                        type="button"
                        className="settings-logistics__rule-add-card"
                        disabled={busy}
                        onClick={() => onChange([...partners, partnerId])}
                      >
                        {PARTNER_IMAGES[partnerId] && (
                          <img src={PARTNER_IMAGES[partnerId]} alt="" />
                        )}
                        <span>{rulePartnerShortLabel(partnerId)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
};

export const DeliveryPartnerRulesSettings: React.FC<DeliveryPartnerRulesSettingsProps> = ({
  rules,
  onSaved,
  onError,
  updatedBy = null,
}) => {
  const [draft, setDraft] = useState<LogisticsDeliveryRulesMatrix>(() => structuredClone(rules));
  const [busy, setBusy] = useState(false);
  const [openCell, setOpenCell] = useState<OpenCell | null>(null);

  const dirty = useMemo(() => !deliveryRulesEqual(draft, rules), [draft, rules]);

  useEffect(() => {
    setDraft(structuredClone(rules));
  }, [rules]);

  const updateCell = (
    region: LogisticsDestinationRegion,
    site: StaffLogisticsSite,
    partners: LogisticsPartnerId[],
  ) => {
    setDraft(prev => patchDeliveryRuleCell(prev, region, site, partners));
  };

  const handleSave = async () => {
    setBusy(true);
    onError('');
    setOpenCell(null);
    try {
      const saved = await saveLogisticsDeliveryRules(draft, updatedBy);
      setDraft(structuredClone(saved));
      onSaved(saved);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save delivery rules.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetDefaults = () => {
    setOpenCell(null);
    setDraft(structuredClone(DEFAULT_LOGISTICS_DELIVERY_RULES));
  };

  const isCellOpen = (region: LogisticsDestinationRegion, site: StaffLogisticsSite) => (
    openCell?.region === region && openCell.site === site
  );

  return (
    <div className="settings-logistics__section panel settings-logistics__section--rules">
      <div className="settings-logistics__default-head settings-logistics__default-head--compact">
        <div>
          <h4 className="settings-logistics__title">Delivery partner rules</h4>
          <p className="settings-logistics__rule-hint text-muted text-sm">
            Assign partners to each state × ship-from cell. Active / Manual / Inactive is set on
            each partner under Delivery Partners. Sales orders only offer Active or Manual partners
            from the rule.
          </p>
        </div>
        <div className="settings-logistics__rule-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={handleResetDefaults}
          >
            <RotateCcw size={14} aria-hidden />
            Reset
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!dirty || busy}
            onClick={() => void handleSave()}
          >
            <Save size={15} aria-hidden />
            Save
          </button>
        </div>
      </div>

      <div className="settings-logistics__rules-grid" role="grid" aria-label="Delivery partner rules">
        <div className="settings-logistics__rules-grid-head" role="columnheader">States</div>
        {STAFF_LOGISTICS_SITES.map(site => (
          <div key={site} className="settings-logistics__rules-grid-head" role="columnheader">
            {STAFF_LOGISTICS_SITE_LABELS[site]}
          </div>
        ))}

        {LOGISTICS_DESTINATION_REGIONS.map(region => (
          <React.Fragment key={region}>
            <div
              className={`settings-logistics__rule-region settings-logistics__rule-region--${region}`}
              role="rowheader"
            >
              {LOGISTICS_DESTINATION_REGION_LABELS[region]}
            </div>
            {STAFF_LOGISTICS_SITES.map(site => (
              <div
                key={`${region}-${site}`}
                className={`settings-logistics__rules-grid-cell settings-logistics__rules-grid-cell--${region}`}
                role="gridcell"
              >
                <RuleCell
                  region={region}
                  site={site}
                  partners={draft[region][site]}
                  busy={busy}
                  isOpen={isCellOpen(region, site)}
                  onOpen={() => setOpenCell({ region, site })}
                  onClose={() => setOpenCell(null)}
                  onChange={partners => updateCell(region, site, partners)}
                />
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
