import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Lock,
  Phone,
  RefreshCw,
  Save,
  UserPlus,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CreateDealerUserModal } from '../../components/dealers/CreateDealerUserModal';
import { DealerStatusCell } from '../../components/dealers/DealerStatusCell';
import { FetchingLoader } from '../../components/FetchingLoader';
import { MultiSelect } from '../../components/dealers/MultiSelect';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import { getDealerStatusMeta } from '../../lib/dealerStatus';
import {
  dealerErrorMessage,
  fetchDealerById,
  fetchDealerCategories,
  fetchDealerLocations,
  fetchKams,
  linkDealerPortalUser,
  patchDealer,
  refreshDealerFromZoho,
} from '../../lib/dealers';
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
>;

function dealerToDraft(dealer: ZohoDealer): OverlayDraft {
  return {
    firstName: dealer.firstName,
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
  };
}

function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);
}

function dealerInitials(dealer: ZohoDealer): string {
  const name = dealer.companyName || dealer.contactName || '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function ZohoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="dealers-detail__zoho-field">
      <span className="dealers-detail__zoho-label">{label}</span>
      <span className="dealers-detail__zoho-value">{value ?? '—'}</span>
    </div>
  );
}

function ZohoFieldBlock({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) {
    return <ZohoField label={label} value={null} />;
  }
  return (
    <div className="dealers-detail__zoho-field dealers-detail__zoho-field--block">
      <span className="dealers-detail__zoho-label">{label}</span>
      <p className="dealers-detail__zoho-block">{value}</p>
    </div>
  );
}

function formatGstTreatment(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatZohoTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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

export const DealerDetailPage: React.FC = () => {
  const { dealerId } = useParams<{ dealerId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const listPath = location.pathname.replace(/\/[^/]+$/, '');
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
  const [page, setPage] = useState<1 | 2>(1);
  const [showCreateUser, setShowCreateUser] = useState(false);

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

  const refreshZoho = async () => {
    if (!dealerId) return;
    setRefreshingZoho(true);
    setError('');
    try {
      const data = await refreshDealerFromZoho(dealerId);
      setDealer(data);
      setDraft(dealerToDraft(data));
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setRefreshingZoho(false);
    }
  };

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

  const saveDraft = async () => {
    if (!dealer || !draft) return;
    setSaving(true);
    setError('');
    try {
      await patchDealer(dealer.id, draft);
      const refreshed = await fetchDealerById(dealer.id);
      setDealer(refreshed);
      setDraft(dealerToDraft(refreshed));
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
  const phone = dealer ? (draft?.phone || dealer.phone || dealer.mobile) : null;
  const whatsapp = dealer ? (draft?.whatsappNumber || dealer.whatsappNumber || phone) : null;
  const contactLinks = phone ? buildContactLinks(phone) : null;
  const whatsappLinks = whatsapp ? buildContactLinks(whatsapp) : null;
  const statusMeta = dealer ? getDealerStatusMeta(dealer) : null;
  const isActiveStage = dealer?.dealerStage === 'Active';

  return (
    <div className="page-content fade-in dealers-detail-page">
      <div className="dealers-detail__topbar">
        <button
          type="button"
          className="dealers-detail__back catalog-filters__back-btn"
          onClick={() => navigate(listPath)}
        >
          <ArrowLeft size={18} aria-hidden />
          <span>Back to dealers</span>
        </button>
        {dealer && (
          <button
            type="button"
            className="btn btn-primary btn-sm dealers-detail__save-top"
            disabled={saving || !dirty}
            onClick={() => void saveDraft()}
          >
            <Save size={15} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

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
            <div className="dealers-detail__avatar" aria-hidden>
              {dealerInitials(dealer)}
              {dealer.signedIn && (
                <span className="dealers-detail__avatar-badge" title="Portal user linked">✓</span>
              )}
            </div>
            <div className="dealers-detail__hero-body">
              <h1 className="dealers-detail__hero-title">{name}</h1>
              <div className="dealers-detail__hero-badges">
                {isActiveStage && (
                  <span className="dealers-detail__badge dealers-detail__badge--auth">
                    Authorized YesWeigh dealer
                  </span>
                )}
                <span className={`dealers-detail__badge dealers-detail__badge--${dealer.status}`}>
                  {dealer.status}
                </span>
              </div>
              <p className="dealers-detail__hero-id">ID {dealer.id}</p>
            </div>
            <div className="dealers-detail__hero-status">
              <DealerStatusCell
                dealer={dealer}
                onStageChange={stage => setDraft(d => d ? { ...d, dealerStage: stage } : d)}
              />
              <span className="text-muted text-sm">{statusMeta?.label}</span>
            </div>
          </header>

          {page === 1 ? (
            <>
              <section className="dealers-detail panel glass">
                <div className="dealers-detail__section-head">
                  <h3 className="dealers-detail__section-title">From Zoho · read only</h3>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={refreshingZoho || saving}
                    onClick={() => void refreshZoho()}
                  >
                    <RefreshCw size={14} className={refreshingZoho ? 'spin-icon' : undefined} />
                    {refreshingZoho ? 'Refreshing…' : 'Refresh from Zoho'}
                  </button>
                </div>
                <div className="dealers-detail__zoho-grid">
                  <ZohoField label="Company" value={dealer.companyName || dealer.contactName} />
                  <ZohoField label="Legal name" value={dealer.zohoLegalName} />
                  <ZohoField label="Zoho contact ID" value={dealer.id} />
                  <ZohoField label="Zoho contact name" value={dealer.contactName} />
                  <ZohoField label="Zoho status" value={dealer.status} />
                  <ZohoField label="Customer type" value={dealer.zohoCustomerSubType} />
                  <ZohoField label="Email" value={dealer.email} />
                  <ZohoField label="Mobile (Zoho)" value={dealer.mobile} />
                  <ZohoField label="Phone (Zoho)" value={dealer.phone} />
                  <ZohoField label="Website" value={dealer.zohoWebsite} />
                  <ZohoField label="GST number" value={dealer.zohoGstNo} />
                  <ZohoField label="GST treatment" value={formatGstTreatment(dealer.zohoGstTreatment)} />
                  <ZohoField label="PAN" value={dealer.zohoPanNo} />
                  <ZohoField
                    label="Place of supply"
                    value={dealer.zohoPlaceOfContactLabel || dealer.zohoPlaceOfContact}
                  />
                  <ZohoField
                    label="Tax"
                    value={dealer.zohoTaxName
                      ? `${dealer.zohoTaxName}${dealer.zohoTaxPercentage != null ? ` (${dealer.zohoTaxPercentage}%)` : ''}`
                      : null}
                  />
                  <ZohoField label="Payment terms" value={dealer.zohoPaymentTermsLabel} />
                  <ZohoField label="Currency" value={dealer.zohoCurrencyCode} />
                  <ZohoField
                    label="Credit limit (Zoho)"
                    value={dealer.zohoCreditLimit != null ? formatInr(dealer.zohoCreditLimit) : null}
                  />
                  <ZohoField label="Price book" value={dealer.zohoPricebookName} />
                  <ZohoField label="Zoho owner" value={dealer.zohoOwnerName} />
                  <ZohoField label="Branch" value={dealer.zohoBranchName} />
                  <ZohoField label="Location" value={dealer.zohoLocationName} />
                  <ZohoField
                    label="Portal (Zoho)"
                    value={dealer.zohoPortalStatusLabel || dealer.zohoPortalStatus}
                  />
                  <ZohoField label="Outstanding due" value={formatInr(dealer.outstandingReceivable)} />
                  <ZohoField label="Unused credits" value={formatInr(dealer.unusedCredits)} />
                  <ZohoField
                    label="Has transactions"
                    value={dealer.zohoHasTransaction ? 'Yes' : dealer.zohoDetailSyncedAt ? 'No' : null}
                  />
                  <ZohoField
                    label="Linked to Zoho CRM"
                    value={dealer.zohoIsLinkedWithZohoCrm ? 'Yes' : dealer.zohoDetailSyncedAt ? 'No' : null}
                  />
                  <ZohoField label="Created in Zoho" value={formatZohoTime(dealer.zohoCreatedTime)} />
                  <ZohoField label="Modified in Zoho" value={formatZohoTime(dealer.zohoLastModifiedTime)} />
                  <ZohoField
                    label="Last list sync"
                    value={dealer.syncedAt ? new Date(dealer.syncedAt).toLocaleString() : null}
                  />
                  <ZohoField
                    label="Last detail sync"
                    value={dealer.zohoDetailSyncedAt
                      ? new Date(dealer.zohoDetailSyncedAt).toLocaleString()
                      : null}
                  />
                </div>
                {(dealer.zohoBillingAddress || dealer.zohoShippingAddress) && (
                  <div className="dealers-detail__zoho-addresses">
                    <ZohoFieldBlock label="Billing address (Zoho)" value={dealer.zohoBillingAddress} />
                    <ZohoFieldBlock label="Shipping address (Zoho)" value={dealer.zohoShippingAddress} />
                  </div>
                )}
                {dealer.zohoNotes && (
                  <div className="dealers-detail__zoho-notes">
                    <ZohoFieldBlock label="Notes (Zoho)" value={dealer.zohoNotes} />
                  </div>
                )}
              </section>

              {(dealer.zohoContactPersons?.length ?? 0) > 0 && (
                <section className="dealers-detail panel glass">
                  <h3 className="dealers-detail__section-title">Contact persons · Zoho</h3>
                  <div className="dealers-detail__contact-persons">
                    {dealer.zohoContactPersons!.map(person => (
                      <div key={person.id ?? person.name ?? 'unknown'} className="dealers-detail__contact-person">
                        <div className="dealers-detail__contact-person-head">
                          <strong>{person.name || 'Unnamed contact'}</strong>
                          {person.isPrimary && (
                            <span className="dealers-detail__badge dealers-detail__badge--auth">Primary</span>
                          )}
                        </div>
                        <div className="dealers-detail__zoho-grid dealers-detail__zoho-grid--compact">
                          <ZohoField label="Designation" value={person.designation} />
                          <ZohoField label="Department" value={person.department} />
                          <ZohoField label="Phone" value={person.phone || person.mobile} />
                          <ZohoField label="Email" value={person.email} />
                          <ZohoField
                            label="Portal"
                            value={person.isAddedInPortal ? 'Added' : 'Not added'}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {(dealer.zohoTags?.length ?? 0) > 0 && (
                <section className="dealers-detail panel glass">
                  <h3 className="dealers-detail__section-title">Tags · Zoho</h3>
                  <div className="dealers-detail__tag-list">
                    {dealer.zohoTags!.map(tag => (
                      <span key={tag} className="dealers-detail__tag">{tag}</span>
                    ))}
                  </div>
                </section>
              )}

              {(dealer.zohoCustomFields?.length ?? 0) > 0 && (
                <section className="dealers-detail panel glass">
                  <h3 className="dealers-detail__section-title">Custom fields · Zoho</h3>
                  <div className="dealers-detail__zoho-grid">
                    {dealer.zohoCustomFields!.map((field, index) => {
                      const row = field as { label?: string; value?: unknown; api_name?: string };
                      const label = row.label || row.api_name || `Field ${index + 1}`;
                      const value = row.value != null ? String(row.value) : null;
                      return <ZohoField key={`${label}-${index}`} label={label} value={value} />;
                    })}
                  </div>
                </section>
              )}

              <section className="dealers-detail panel glass">
                <h3 className="dealers-detail__section-title">Contact · local edits</h3>
                <div className="dealers-detail__form">
                  <label className="dealers-detail__field">
                    <span>Contact / owner name</span>
                    <input
                      className="input-field"
                      value={draft.firstName ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, firstName: e.target.value || null } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field">
                    <span>Phone</span>
                    <input
                      className="input-field"
                      value={draft.phone ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, phone: e.target.value || null } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field">
                    <span>Designation</span>
                    <input
                      className="input-field"
                      value={draft.designation ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, designation: e.target.value || null } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field">
                    <span>Alternate mobile</span>
                    <input
                      className="input-field"
                      value={draft.alternateMobile ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, alternateMobile: e.target.value || null } : d)}
                    />
                  </label>
                  <label className="dealers-detail__field dealers-detail__field--full">
                    <span>WhatsApp number</span>
                    <input
                      className="input-field"
                      value={draft.whatsappNumber ?? ''}
                      disabled={saving}
                      onChange={e => setDraft(d => d ? { ...d, whatsappNumber: e.target.value || null } : d)}
                    />
                  </label>
                </div>
                {(contactLinks || whatsappLinks) && (
                  <div className="dealers-detail__contact-actions">
                    {contactLinks && (
                      <a href={contactLinks.tel} className="btn btn-secondary btn-sm">
                        <Phone size={15} />
                        Call
                      </a>
                    )}
                    {whatsappLinks && (
                      <a
                        href={whatsappLinks.whatsapp}
                        className="btn btn-secondary btn-sm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <WhatsAppIcon />
                        WhatsApp
                      </a>
                    )}
                  </div>
                )}
              </section>

              <section className="dealers-detail panel glass">
                <h3 className="dealers-detail__section-title">Assignment</h3>
                <div className="dealers-detail__form">
                  <label className="dealers-detail__field">
                    <span>KAM</span>
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
                  <label className="dealers-detail__field">
                    <span>Stage</span>
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
                  <label className="dealers-detail__field dealers-detail__field--full">
                    <span>Categories</span>
                    <MultiSelect
                      placeholder="Select categories"
                      menuPortal
                      value={draft.categories}
                      options={categories.map(c => ({ value: c, label: c }))}
                      onChange={next => setDraft(d => d ? { ...d, categories: next } : d)}
                    />
                  </label>
                </div>
              </section>

              <section className="dealers-detail panel glass">
                <h3 className="dealers-detail__section-title">Portal login</h3>
                {dealer.signedIn ? (
                  <div className="dealers-detail__portal">
                    <ZohoField label="Portal user" value={dealer.portalUserName} />
                    <ZohoField label="Login ID" value={dealer.portalLoginId} />
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
            </>
          ) : (
            <>
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
                  <div className="dealers-detail__field">
                    <span className="dealers-detail__zoho-label">Outstanding due (Zoho)</span>
                    <p className="dealers-detail__zoho-readout">{formatInr(dealer.outstandingReceivable)}</p>
                  </div>
                  {dealer.zohoCreditLimit != null && (
                    <div className="dealers-detail__field">
                      <span className="dealers-detail__zoho-label">Credit limit (Zoho)</span>
                      <p className="dealers-detail__zoho-readout">{formatInr(dealer.zohoCreditLimit)}</p>
                    </div>
                  )}
                  {dealer.zohoPricebookName && (
                    <div className="dealers-detail__field">
                      <span className="dealers-detail__zoho-label">Price book (Zoho)</span>
                      <p className="dealers-detail__zoho-readout">{dealer.zohoPricebookName}</p>
                    </div>
                  )}
                </div>
              </section>

              {(dealer.zohoBillingAddress || dealer.zohoShippingAddress) && (
                <section className="dealers-detail panel glass">
                  <h3 className="dealers-detail__section-title">Addresses · Zoho (read only)</h3>
                  <div className="dealers-detail__zoho-addresses">
                    <ZohoFieldBlock label="Billing" value={dealer.zohoBillingAddress} />
                    <ZohoFieldBlock label="Shipping" value={dealer.zohoShippingAddress} />
                  </div>
                </section>
              )}

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
                    disabled={saving || !dirty}
                    onClick={() => void saveDraft()}
                  >
                    <Save size={16} />
                    Save changes
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

          <footer className="dealers-detail__pager panel glass">
            <span className="text-muted text-sm">Page {page} of 2</span>
            {page === 1 ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(2)}
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(1)}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            )}
          </footer>
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
  );
};
