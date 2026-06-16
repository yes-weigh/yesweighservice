import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Lock,
  Phone,
  RefreshCw,
  Save,
  UserPlus,
} from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { CreateDealerUserModal } from '../../components/dealers/CreateDealerUserModal';
import { DealerStatusIndicator } from '../../components/dealers/DealerStatusIndicator';
import { FetchingLoader } from '../../components/FetchingLoader';
import { MultiSelect } from '../../components/dealers/MultiSelect';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import {
  dealerErrorMessage,
  fetchDealerById,
  fetchDealerCategories,
  fetchDealerLocations,
  fetchKams,
  linkDealerPortalUser,
  patchDealer,
  pushDealerChangesToZoho,
  refreshDealerFromZoho,
} from '../../lib/dealers';
import {
  zohoPushableBaseline,
  type ZohoPushableFields,
} from '../../lib/dealerZohoPush';
import {
  blankFillableFieldKeys,
  buildZohoPushPayload,
  fillableFieldsToDraft,
  hasZohoPushChanges,
  visibleFillableFields,
  type ZohoFillableDraft,
  type ZohoFillableFieldDef,
  type ZohoFillableFieldKey,
} from '../../lib/dealerZohoFillable';
import { getDealerStatusMeta } from '../../lib/dealerStatus';
import { buildContactLinks } from '../../lib/phoneLinks';
import { registerUser } from '../../lib/userAdmin';
import type { Kam, ZohoDealer } from '../../types/dealers';
import {
  DEALER_STAGES,
  DEALER_TYPES,
  FIRM_TYPES,
  PRICE_LEVELS,
} from '../../types/dealers';

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.274-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

type OverlayDraft = Pick<
  ZohoDealer,
  | 'firstName'
  | 'email'
  | 'phone'
  | 'designation'
  | 'alternateMobile'
  | 'whatsappNumber'
  | 'dealerType'
  | 'firmType'
  | 'creditLimit'
  | 'priceLevel'
  | 'billingAddress'
  | 'shippingAddress'
  | 'googleMapsUrl'
  | 'billingState'
  | 'district'
  | 'zipCode'
  | 'kamId'
  | 'dealerStage'
  | 'categories'
  | 'canBuySpares'
  | 'orderPayOffline'
  | 'orderPayOnline'
  | 'adminApprovalRequired'
  | 'maxOrderLimit'
> & ZohoFillableDraft;

function dealerToDraft(dealer: ZohoDealer): OverlayDraft {
  return {
    firstName: dealer.firstName,
    email: dealer.email,
    phone: dealer.phone,
    designation: dealer.designation ?? null,
    alternateMobile: dealer.alternateMobile ?? null,
    whatsappNumber: dealer.whatsappNumber ?? null,
    dealerType: dealer.dealerType ?? null,
    firmType: dealer.firmType ?? null,
    creditLimit: dealer.creditLimit ?? null,
    priceLevel: dealer.priceLevel ?? null,
    billingAddress: dealer.billingAddress ?? null,
    shippingAddress: dealer.shippingAddress ?? null,
    googleMapsUrl: dealer.googleMapsUrl ?? null,
    billingState: dealer.billingState,
    district: dealer.district,
    zipCode: dealer.zipCode,
    kamId: dealer.kamId,
    dealerStage: dealer.dealerStage,
    categories: [...dealer.categories],
    canBuySpares: dealer.canBuySpares !== false,
    orderPayOffline: dealer.orderPayOffline !== false,
    orderPayOnline: Boolean(dealer.orderPayOnline),
    adminApprovalRequired: Boolean(dealer.adminApprovalRequired),
    maxOrderLimit: dealer.maxOrderLimit ?? null,
    ...fillableFieldsToDraft(dealer),
  };
}

function formatZohoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function contactPersonDisplayName(dealer: ZohoDealer): string | null {
  const zohoName = dealer.zohoPrimaryContact?.name?.trim()
    || dealer.zohoContactPersons?.find(p => p.isPrimary)?.name?.trim()
    || dealer.zohoContactPersons?.[0]?.name?.trim();
  return zohoName || null;
}

function dealerInitials(dealer: ZohoDealer): string {
  const name = dealer.companyName || dealer.contactName || '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function FieldLabel({
  label,
  source,
}: {
  label: string;
  source?: 'zoho' | 'local';
}) {
  return (
    <span className="dealers-detail__field-label">
      {label}
      {source === 'zoho' && (
        <span className="dealers-detail__field-source dealers-detail__field-source--zoho">
          Push to Zoho
        </span>
      )}
      {source === 'local' && (
        <span className="dealers-detail__field-source dealers-detail__field-source--local">
          App only
        </span>
      )}
    </span>
  );
}

function ContactNumberField({
  label,
  fieldSource,
  value,
  onChange,
  disabled,
  showCall = true,
  showWhatsApp = false,
  full,
}: {
  label: string;
  fieldSource?: 'zoho' | 'local';
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  showCall?: boolean;
  showWhatsApp?: boolean;
  full?: boolean;
}) {
  const links = value.trim() ? buildContactLinks(value) : null;

  return (
    <label className={`dealers-detail__field${full ? ' dealers-detail__field--full' : ''}`}>
      <FieldLabel label={label} source={fieldSource} />
      <div className="dealers-detail__input-actions">
        <input
          className="input-field"
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
        {(showCall || showWhatsApp) && (
          <div className="dealers-detail__input-action-btns">
            {showCall && links && (
              <a
                href={links.tel}
                className="dealers-detail__icon-action dealers-detail__icon-action--call"
                aria-label={`Call ${label}`}
              >
                <Phone size={16} strokeWidth={2.25} />
              </a>
            )}
            {showWhatsApp && links && (
              <a
                href={links.whatsapp}
                className="dealers-detail__icon-action dealers-detail__icon-action--whatsapp"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp ${label}`}
              >
                <WhatsAppIcon />
              </a>
            )}
          </div>
        )}
      </div>
    </label>
  );
}

function ReadOnlyTileField({
  label,
  value,
  full,
  multiline,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
  multiline?: boolean;
}) {
  const empty = value == null || value === '';
  return (
    <div className={`dealers-detail__field dealers-detail__tile-field${full ? ' dealers-detail__field--full' : ''}`}>
      <span>{label}</span>
      <div
        className={`dealers-detail__tile-value${multiline ? ' dealers-detail__tile-value--block' : ''}${empty ? ' dealers-detail__tile-value--empty' : ''}`}
      >
        {empty ? '—' : value}
      </div>
    </div>
  );
}

function BlankOrReadOnlyZohoField({
  field,
  dealer,
  draftValue,
  editable,
  disabled,
  onChange,
}: {
  field: ZohoFillableFieldDef;
  dealer: ZohoDealer;
  draftValue: string;
  editable: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const storedValue = field.getValue(dealer);
  const displayValue = field.key === 'zohoGstTreatment'
    ? formatGstTreatment(storedValue)
    : storedValue;

  if (!editable) {
    return (
      <ReadOnlyTileField
        label={field.label}
        value={displayValue}
        full={field.full}
        multiline={field.multiline}
      />
    );
  }

  const input = field.multiline ? (
    <textarea
      className="input-field dealers-detail__textarea"
      rows={3}
      value={draftValue}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    />
  ) : (
    <input
      className="input-field"
      value={draftValue}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    />
  );

  return (
    <label className={`dealers-detail__field${field.full ? ' dealers-detail__field--full' : ''}`}>
      <FieldLabel label={field.label} source="zoho" />
      {input}
    </label>
  );
}

function formatGstTreatment(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function ToggleField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="dealers-detail__toggle">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`dealers-detail__toggle-btn ${checked ? 'dealers-detail__toggle-btn--on' : ''}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="dealers-detail__toggle-knob" />
      </button>
    </label>
  );
}

const PULL_REFRESH_THRESHOLD = 72;
const PULL_REFRESH_MAX = 96;

export const DealerDetailPage: React.FC = () => {
  const { dealerId } = useParams<{ dealerId: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const preview = (location.state as { dealer?: ZohoDealer } | null)?.dealer;

  const [dealer, setDealer] = useState<ZohoDealer | null>(
    preview && preview.id === dealerId ? preview : null,
  );
  const [draft, setDraft] = useState<OverlayDraft | null>(
    preview && preview.id === dealerId ? dealerToDraft(preview) : null,
  );
  const [kams, setKams] = useState<Kam[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [loading, setLoading] = useState(!dealer);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshingZoho, setRefreshingZoho] = useState(false);
  const [zohoBaseline, setZohoBaseline] = useState<ZohoPushableFields | null>(
    preview && preview.id === dealerId ? zohoPushableBaseline(preview) : null,
  );
  const [blankFillableKeys, setBlankFillableKeys] = useState<ZohoFillableFieldKey[]>(
    preview && preview.id === dealerId ? blankFillableFieldKeys(preview) : [],
  );
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [pullOffset, setPullOffset] = useState(0);
  const pullStateRef = useRef({ startY: 0, pulling: false, distance: 0 });

  const loadDealer = useCallback(async () => {
    if (!dealerId) return;
    setError('');
    setDealer(prev => {
      if (!prev) setLoading(true);
      return prev;
    });
    try {
      const data = await fetchDealerById(dealerId);
      setDealer(data);
      setDraft(dealerToDraft(data));
      setZohoBaseline(zohoPushableBaseline(data));
      setBlankFillableKeys(blankFillableFieldKeys(data));
      setError('');
    } catch (err) {
      setDealer(prev => {
        if (!prev) setError(dealerErrorMessage(err));
        return prev;
      });
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  const refreshZoho = useCallback(async () => {
    if (!dealerId) return;
    setRefreshingZoho(true);
    setError('');
    try {
      const data = await refreshDealerFromZoho(dealerId);
      setDealer(data);
      setDraft(dealerToDraft(data));
      setZohoBaseline(zohoPushableBaseline(data));
      setBlankFillableKeys(blankFillableFieldKeys(data));
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setRefreshingZoho(false);
    }
  }, [dealerId]);

  const refreshZohoRef = useRef(refreshZoho);
  refreshZohoRef.current = refreshZoho;

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      if (refreshingZoho || window.scrollY > 4) return;
      pullStateRef.current.startY = event.touches[0]?.clientY ?? 0;
      pullStateRef.current.pulling = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!pullStateRef.current.pulling || window.scrollY > 4) return;
      const currentY = event.touches[0]?.clientY ?? 0;
      const delta = currentY - pullStateRef.current.startY;
      if (delta <= 0) {
        pullStateRef.current.distance = 0;
        setPullOffset(0);
        return;
      }
      const distance = Math.min(delta * 0.55, PULL_REFRESH_MAX);
      pullStateRef.current.distance = distance;
      setPullOffset(distance);
      if (distance > 8) {
        event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (!pullStateRef.current.pulling) return;
      const shouldRefresh = pullStateRef.current.distance >= PULL_REFRESH_THRESHOLD;
      pullStateRef.current.pulling = false;
      pullStateRef.current.distance = 0;
      setPullOffset(0);
      if (shouldRefresh) {
        void refreshZohoRef.current();
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [refreshingZoho]);

  useEffect(() => {
    void loadDealer();
  }, [loadDealer]);

  useEffect(() => {
    void Promise.all([
      fetchKams().then(setKams),
      fetchDealerCategories().then(setCategories),
      fetchDealerLocations().then(res => {
        setStates(res.states);
        return res;
      }),
    ]).catch(err => console.error('Dealer detail meta load failed:', err));
  }, []);

  useEffect(() => {
    const state = draft?.billingState ?? dealer?.billingState;
    if (!state) {
      setDistricts([]);
      return;
    }
    void fetchDealerLocations().then(res => {
      setDistricts(res.districtsByState[state] ?? []);
    });
  }, [draft?.billingState, dealer?.billingState]);

  const dirty = useMemo(() => {
    if (!dealer || !draft) return false;
    return JSON.stringify(dealerToDraft(dealer)) !== JSON.stringify(draft);
  }, [dealer, draft]);

  const zohoDirty = useMemo(() => {
    if (!dealer || !draft || !zohoBaseline) return false;
    const payload = buildZohoPushPayload(draft, dealer, zohoBaseline, blankFillableKeys);
    return hasZohoPushChanges(payload);
  }, [dealer, draft, zohoBaseline, blankFillableKeys]);

  const saveButtonLabel = useMemo(() => {
    if (saving) return zohoDirty ? 'Pushing & saving…' : 'Saving…';
    if (zohoDirty) return 'Push to Zoho and save';
    return 'Save changes';
  }, [saving, zohoDirty]);

  const saveDraft = async () => {
    if (!dealer || !draft || !dirty) return;
    setSaving(true);
    setError('');
    try {
      if (zohoDirty && zohoBaseline) {
        const payload = buildZohoPushPayload(draft, dealer, zohoBaseline, blankFillableKeys);
        await pushDealerChangesToZoho(dealer.id, payload);
      }
      await patchDealer(dealer.id, draft);
      const refreshed = await fetchDealerById(dealer.id);
      setDealer(refreshed);
      setDraft(dealerToDraft(refreshed));
      setZohoBaseline(zohoPushableBaseline(refreshed));
      setBlankFillableKeys(blankFillableFieldKeys(refreshed));
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const blockDealer = async () => {
    if (!dealer) return;
    if (!window.confirm(`Block ${dealer.companyName || dealer.contactName}?`)) return;
    setSaving(true);
    setError('');
    try {
      await patchDealer(dealer.id, {
        dealerStage: 'Black listed',
        isFiltered: true,
        filterReason: 'Manual',
      });
      await loadDealer();
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePortalUser = async (payload: {
    loginId: string;
    password: string;
    displayName: string;
    phone?: string;
    email?: string;
  }) => {
    if (!dealer || !user) return;
    const uid = await registerUser(db, {
      loginId: payload.loginId,
      password: payload.password,
      displayName: payload.displayName,
      role: 'dealer',
      phone: payload.phone,
      email: payload.email,
      zohoCustomerId: dealer.id,
      createdByUid: user.uid,
    });
    await linkDealerPortalUser(dealer.id, uid);
    await loadDealer();
  };

  if (!dealerId) return null;

  const name = dealer ? (dealer.companyName || dealer.contactName) : '';
  const statusMeta = dealer && draft
    ? getDealerStatusMeta({ dealerStage: draft.dealerStage, signedIn: dealer.signedIn })
    : null;
  const contactPersonName = dealer ? contactPersonDisplayName(dealer) : null;
  const zohoCreatedOn = dealer ? formatZohoDate(dealer.zohoCreatedTime) : null;

  const setFillableDraftField = (key: ZohoFillableFieldKey, value: string) => {
    setDraft(d => {
      if (!d) return d;
      return { ...d, [key]: value || null };
    });
  };

  const otherZohoContactPersons = (dealer?.zohoContactPersons ?? []).filter(p => !p.isPrimary);
  const pullRefreshLabel = refreshingZoho
    ? 'Refreshing from Zoho…'
    : pullOffset >= PULL_REFRESH_THRESHOLD
      ? 'Release to refresh'
      : 'Pull down to refresh';

  return (
    <div
      className={`page-content fade-in dealers-detail-page${dirty ? ' dealers-detail-page--dirty' : ''}`}
    >
      {(pullOffset > 0 || refreshingZoho) && (
        <div
          className="dealers-detail__pull-refresh"
          style={{ height: refreshingZoho ? PULL_REFRESH_MAX : Math.max(pullOffset, 32) }}
          aria-live="polite"
        >
          <RefreshCw size={18} className={refreshingZoho ? 'spin-icon' : undefined} />
          <span>{pullRefreshLabel}</span>
        </div>
      )}

      <div
        className="dealers-detail-page__body"
        style={pullOffset > 0 && !refreshingZoho ? { transform: `translateY(${pullOffset}px)` } : undefined}
      >
      {error && (
        <div className="products-inline-error panel glass">
          <span>{error}</span>
        </div>
      )}

      {loading && !dealer ? (
        <div className="dealers-detail panel glass">
          <FetchingLoader label="Fetching dealer" />
        </div>
      ) : !dealer || !draft ? (
        <div className="dealers-detail panel glass">
          <p className="text-muted">Dealer not found.</p>
        </div>
      ) : (
        <>
          <header className="dealers-detail__hero panel glass">
            <div className="dealers-detail__hero-top">
              <div className="dealers-detail__hero-main">
                <div className="dealers-detail__avatar" aria-hidden>
                  {dealerInitials(dealer)}
                  {dealer.signedIn && (
                    <span className="dealers-detail__avatar-badge" title="Portal user linked">✓</span>
                  )}
                </div>
                <div className="dealers-detail__hero-body">
                  <h1 className="dealers-detail__hero-title">{name}</h1>
                  <p className="dealers-detail__hero-id">ID {dealer.id}</p>
                  {contactPersonName && (
                    <p className="dealers-detail__hero-meta">{contactPersonName}</p>
                  )}
                  {zohoCreatedOn && (
                    <p className="dealers-detail__hero-meta">
                      Zoho created {zohoCreatedOn}
                    </p>
                  )}
                </div>
              </div>
              {statusMeta && (
                <DealerStatusIndicator
                  meta={statusMeta}
                  className="dealers-detail__hero-status"
                />
              )}
            </div>
          </header>

              <section className="dealers-detail panel glass">
                <div className="dealers-detail__section-head">
                  <h3 className="dealers-detail__section-title">From Zoho · updatables</h3>
                </div>
                <div className="dealers-detail__form">
                  <label className="dealers-detail__field">
                    <FieldLabel label="Contact / owner name" source="zoho" />
                    <input
                      className="input-field"
                      value={draft.firstName ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, firstName: e.target.value || null } : d)}
                    />
                  </label>
                  <ContactNumberField
                    label="Phone"
                    fieldSource="zoho"
                    value={draft.phone ?? ''}
                    disabled={saving}
                    showCall
                    showWhatsApp
                    onChange={v => setDraft(d => d ? { ...d, phone: v || null } : d)}
                  />
                  <label className="dealers-detail__field">
                    <FieldLabel label="Email" source="zoho" />
                    <input
                      type="email"
                      className="input-field"
                      value={draft.email ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, email: e.target.value || null } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field">
                    <FieldLabel label="Designation" source="zoho" />
                    <input
                      className="input-field"
                      value={draft.designation ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, designation: e.target.value || null } : d)}
                    />
                  </label>
                  <ContactNumberField
                    label="Alternate mobile"
                    fieldSource="zoho"
                    value={draft.alternateMobile ?? ''}
                    disabled={saving}
                    showCall
                    showWhatsApp
                    onChange={v => setDraft(d => d ? { ...d, alternateMobile: v || null } : d)}
                  />

                  <div className="dealers-detail__form-split dealers-detail__field--full">
                    <span className="dealers-detail__form-split-label">App only · not synced to Zoho</span>
                  </div>

                  <ContactNumberField
                    label="WhatsApp number"
                    fieldSource="local"
                    value={draft.whatsappNumber ?? ''}
                    disabled={saving}
                    showCall
                    showWhatsApp
                    full
                    onChange={v => setDraft(d => d ? { ...d, whatsappNumber: v || null } : d)}
                  />
                  <label className="dealers-detail__field">
                    <FieldLabel label="Status" source="local" />
                    <select
                      className="catalog-select"
                      value={draft.dealerStage ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, dealerStage: e.target.value || null } : d)}
                    >
                      <option value="">Unset</option>
                      {DEALER_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <div className="dealers-detail__field dealers-detail__field--full">
                    <FieldLabel label="Categories" source="local" />
                    <MultiSelect
                      placeholder="Select categories"
                      menuPortal
                      value={draft.categories}
                      options={categories.map(c => ({ value: c, label: c }))}
                      onChange={next => setDraft(d => d ? { ...d, categories: next } : d)}
                    />
                  </div>
                  <label className="dealers-detail__field dealers-detail__field--full">
                    <FieldLabel label="Key account manager" source="local" />
                    <select
                      className="catalog-select"
                      value={draft.kamId ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, kamId: e.target.value || null } : d)}
                    >
                      <option value="">Unassigned</option>
                      {kams.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                    </select>
                  </label>

                  <div className="dealers-detail__form-split dealers-detail__field--full">
                    <span className="dealers-detail__form-split-label">
                      Synced from Zoho · blank fields can be filled once
                    </span>
                  </div>

                  {visibleFillableFields(dealer).map(field => (
                    <BlankOrReadOnlyZohoField
                      key={field.key}
                      field={field}
                      dealer={dealer}
                      editable={blankFillableKeys.includes(field.key)}
                      draftValue={field.getDraftValue(draft) ?? ''}
                      disabled={saving}
                      onChange={value => setFillableDraftField(field.key, value)}
                    />
                  ))}

                  <ReadOnlyTileField
                    label="Place of supply"
                    value={dealer.zohoPlaceOfContactLabel || dealer.zohoPlaceOfContact}
                  />
                  <ReadOnlyTileField
                    label="Tax"
                    value={dealer.zohoTaxName
                      ? `${dealer.zohoTaxName}${dealer.zohoTaxPercentage != null ? ` (${dealer.zohoTaxPercentage}%)` : ''}`
                      : null}
                  />
                  {otherZohoContactPersons.length > 0 && (
                    <div className="dealers-detail__field dealers-detail__field--full dealers-detail__tile-group">
                      <span>Other contact persons · Zoho</span>
                      <div className="dealers-detail__contact-persons">
                        {otherZohoContactPersons.map(person => (
                          <div key={person.id ?? person.name ?? 'unknown'} className="dealers-detail__contact-person">
                            <div className="dealers-detail__contact-person-head">
                              <strong>{person.name || 'Unnamed contact'}</strong>
                            </div>
                            <div className="dealers-detail__form dealers-detail__form--readonly dealers-detail__form--nested">
                              <ReadOnlyTileField label="Designation" value={person.designation} />
                              <ReadOnlyTileField label="Department" value={person.department} />
                              <ReadOnlyTileField label="Phone" value={person.phone || person.mobile} />
                              <ReadOnlyTileField label="Email" value={person.email} />
                              <ReadOnlyTileField
                                label="Portal"
                                value={person.isAddedInPortal ? 'Added' : 'Not added'}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(dealer.zohoTags?.length ?? 0) > 0 && (
                    <ReadOnlyTileField
                      label="Tags · Zoho"
                      full
                      value={(
                        <div className="dealers-detail__tag-list">
                          {dealer.zohoTags!.map(tag => (
                            <span key={tag} className="dealers-detail__tag">{tag}</span>
                          ))}
                        </div>
                      )}
                    />
                  )}
                  {dealer.zohoCustomFields?.map((field, index) => {
                    const row = field as { label?: string; value?: unknown; api_name?: string };
                    const label = row.label || row.api_name || `Custom field ${index + 1}`;
                    const value = row.value != null ? String(row.value) : null;
                    return (
                      <ReadOnlyTileField key={`${label}-${index}`} label={label} value={value} />
                    );
                  })}
                </div>
              </section>

              <section className="dealers-detail panel glass">
                <h3 className="dealers-detail__section-title">Portal login</h3>
                {dealer.signedIn ? (
                  <div className="dealers-detail__form dealers-detail__form--readonly">
                    <ReadOnlyTileField label="Portal user" value={dealer.portalUserName} />
                    <ReadOnlyTileField label="Login ID" value={dealer.portalLoginId} />
                  </div>
                ) : (
                  <div className="dealers-detail__portal-empty">
                    <p className="text-muted text-sm">No portal account linked yet.</p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowCreateUser(true)}
                    >
                      <UserPlus size={15} />
                      Create portal user
                    </button>
                  </div>
                )}
              </section>

              <section className="dealers-detail panel glass">
                <h3 className="dealers-detail__section-title">Business · local edits</h3>
                <div className="dealers-detail__form">
                  <label className="dealers-detail__field">
                    <span>Dealer type</span>
                    <select
                      className="catalog-select"
                      value={draft.dealerType ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, dealerType: e.target.value || null } : d)}
                    >
                      <option value="">—</option>
                      {DEALER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="dealers-detail__field">
                    <span>Firm type</span>
                    <select
                      className="catalog-select"
                      value={draft.firmType ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, firmType: e.target.value || null } : d)}
                    >
                      <option value="">—</option>
                      {FIRM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="dealers-detail__field">
                    <span>Credit limit (₹) · local</span>
                    <input
                      type="number"
                      min={0}
                      className="input-field"
                      value={draft.creditLimit ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? {
                        ...d,
                        creditLimit: e.target.value === '' ? null : Number(e.target.value),
                      } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field">
                    <span>Price level · local</span>
                    <select
                      className="catalog-select"
                      value={draft.priceLevel ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, priceLevel: e.target.value || null } : d)}
                    >
                      <option value="">—</option>
                      {PRICE_LEVELS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                </div>
              </section>

              <section className="dealers-detail panel glass">
                <h3 className="dealers-detail__section-title">Address · local edits</h3>
                <div className="dealers-detail__form">
                  <label className="dealers-detail__field dealers-detail__field--full">
                    <span>Billing address</span>
                    <textarea
                      className="input-field dealers-detail__textarea"
                      rows={3}
                      value={draft.billingAddress ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, billingAddress: e.target.value || null } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field dealers-detail__field--full">
                    <span>Shipping address</span>
                    <textarea
                      className="input-field dealers-detail__textarea"
                      rows={3}
                      value={draft.shippingAddress ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, shippingAddress: e.target.value || null } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field">
                    <span>State</span>
                    <select
                      className="catalog-select"
                      value={draft.billingState ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? {
                        ...d,
                        billingState: e.target.value || null,
                        district: null,
                      } : d)}
                    >
                      <option value="">—</option>
                      {states.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="dealers-detail__field">
                    <span>District</span>
                    <select
                      className="catalog-select"
                      value={draft.district ?? ''}
                      disabled={saving || !draft.billingState}
                      onChange={e => setDraft(d => d ? { ...d, district: e.target.value || null } : d)}
                    >
                      <option value="">—</option>
                      {districts.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </label>
                  <label className="dealers-detail__field">
                    <span>PIN code</span>
                    <input
                      className="input-field"
                      value={draft.zipCode ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, zipCode: e.target.value || null } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field dealers-detail__field--full">
                    <span>Google Maps link</span>
                    <div className="dealers-detail__link-field">
                      <input
                        className="input-field"
                        value={draft.googleMapsUrl ?? ''}
                        disabled={saving}
                        onChange={e => setDraft(d => d ? { ...d, googleMapsUrl: e.target.value || null } : d)}
                        placeholder="https://maps.google.com/…"
                      />
                      {draft.googleMapsUrl && (
                        <a
                          href={draft.googleMapsUrl}
                          className="dealers-detail__link-open"
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open map"
                        >
                          <ExternalLink size={16} />
                        </a>
                      )}
                    </div>
                  </label>
                </div>
              </section>

              <section className="dealers-detail panel glass">
                <h3 className="dealers-detail__section-title">Purchase &amp; order settings</h3>
                <div className="dealers-detail__toggles">
                  <ToggleField
                    label="Can buy spare parts"
                    checked={draft.canBuySpares ?? true}
                    disabled={saving}
                    onChange={v => setDraft(d => d ? { ...d, canBuySpares: v } : d)}
                  />
                  <ToggleField
                    label="Order online · pay offline"
                    checked={draft.orderPayOffline ?? true}
                    disabled={saving}
                    onChange={v => setDraft(d => d ? { ...d, orderPayOffline: v } : d)}
                  />
                  <ToggleField
                    label="Order and pay online"
                    checked={draft.orderPayOnline ?? false}
                    disabled={saving}
                    onChange={v => setDraft(d => d ? { ...d, orderPayOnline: v } : d)}
                  />
                  <ToggleField
                    label="Admin approval required"
                    checked={draft.adminApprovalRequired ?? false}
                    disabled={saving}
                    onChange={v => setDraft(d => d ? { ...d, adminApprovalRequired: v } : d)}
                  />
                </div>
                <label className="dealers-detail__field dealers-detail__field--limit">
                  <span>Maximum order limit (₹)</span>
                  <input
                    type="number"
                    min={0}
                    className="input-field"
                    value={draft.maxOrderLimit ?? ''}
                    disabled={saving}
                    onChange={e => setDraft(d => d ? {
                      ...d,
                      maxOrderLimit: e.target.value === '' ? null : Number(e.target.value),
                    } : d)}
                  />
                </label>
              </section>

              <section className="dealers-detail panel glass dealers-detail__actions">
                <h3 className="dealers-detail__section-title">Actions</h3>
                <div className="dealers-detail__action-stack">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving || refreshingZoho || !dirty}
                    onClick={() => void saveDraft()}
                  >
                    <Save size={16} />
                    {saveButtonLabel}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary dealers-detail__action--warn"
                    disabled={saving}
                    onClick={() => void blockDealer()}
                  >
                    <Lock size={16} />
                    Block dealer
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled
                    title="Order history per dealer coming soon"
                  >
                    View orders
                  </button>
                </div>
              </section>
        </>
      )}

      {showCreateUser && dealer && (
        <CreateDealerUserModal
          dealer={dealer}
          onClose={() => setShowCreateUser(false)}
          onSubmit={handleCreatePortalUser}
        />
      )}
      </div>

      {dirty && dealer && (
        <div className="dealers-detail__save-float" role="region" aria-label="Unsaved changes">
          <button
            type="button"
            className="btn btn-primary dealers-detail__save-float-btn"
            disabled={saving || refreshingZoho}
            onClick={() => void saveDraft()}
          >
            <Save size={16} />
            {saveButtonLabel}
          </button>
        </div>
      )}
    </div>
  );
};
