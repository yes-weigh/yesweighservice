import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Phone, RefreshCw, Save, X } from 'lucide-react';
import { DealerAddressBox } from './DealerAddressBox';
import { DealerCreateStatusOverlay, type DealerCreateStatusPhase } from './DealerCreateStatusOverlay';
import { useAuth } from '../../context/AuthContext';
import { isValidPhone, normalizePhone } from '../../lib/loginAuth';
import {
  createDealer,
  dealerErrorMessage,
  dealerStaffSelectOptions,
  fetchGstinDetails,
  listAssignableDealerStaff,
  patchDealer,
} from '../../lib/dealers';
import {
  emptyDealerAddress,
  formatDealerAddress,
  dealerAddressToZoho,
  type DealerAddress,
} from '../../lib/dealerAddress';
import {
  GST_CONSTITUTIONS,
  GST_TAXPAYER_TYPES,
  GST_TREATMENTS,
  withFetchedOption,
} from '../../lib/gstin';
import {
  assignDealerToPriceLevel,
  isDefaultDealerPriceLevel,
  savePriceLevels,
  subscribePriceLevels,
} from '../../lib/priceLevels';
import type { PriceLevel } from '../../types/priceLevels';
import {
  playDealerFailSound,
  playDealerSuccessSound,
  unlockDealerActionAudio,
} from '../../lib/dealerActionSound';
import { upsertCachedDealer } from '../../lib/dealer-cache';
import type { AssignableStaffOption, ZohoDealer } from '../../types/dealers';
import { DEALER_STAGES } from '../../types/dealers';

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeGstin(value: string) {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

function panFromGstin(gstin: string) {
  const next = normalizeGstin(gstin);
  return GSTIN_FORMAT.test(next) ? next.slice(2, 12) : '';
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, '').slice(-10);
}

function telHref(value: string) {
  const digits = phoneDigits(value);
  return digits.length === 10 ? `tel:+91${digits}` : '';
}

function waHref(value: string) {
  const digits = phoneDigits(value);
  return digits.length === 10 ? `https://wa.me/91${digits}` : '';
}

function WhatsAppGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path
        fill="currentColor"
        d="M12.04 2C6.58 2 2.15 6.43 2.15 11.89c0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.86 9.86 0 0 0 4.74 1.21h.01c5.46 0 9.89-4.43 9.89-9.89C22 6.43 17.5 2 12.04 2m5.85 14.01c-.25.7-1.45 1.29-2.01 1.37-.51.08-1.16.11-1.87-.12-.43-.13-.98-.32-1.69-.62-2.97-1.28-4.91-4.27-5.06-4.47-.15-.2-1.22-1.63-1.22-3.11 0-1.48.78-2.21 1.05-2.51.27-.3.59-.38.79-.38h.57c.18 0 .43-.07.67.51.25.6.84 2.06.91 2.21.08.15.12.33.02.53-.1.2-.14.32-.28.5-.14.17-.3.39-.43.52-.14.15-.29.31-.12.6.16.3.73 1.2 1.56 1.95 1.07.96 1.97 1.26 2.25 1.4.28.14.44.12.61-.07.16-.2.7-.81.88-1.09.19-.28.37-.23.63-.14.25.09 1.6.76 1.87.89.28.14.46.2.53.31.07.11.07.64-.18 1.34"
      />
    </svg>
  );
}

function PhoneField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const call = telHref(value);
  const chat = waHref(value);
  return (
    <label className="dealers-modal__field" htmlFor={id}>
      <span>{label}</span>
      <div className="dealers-create-phone">
        {call ? (
          <a className="dealers-create-phone__icon dealers-create-phone__icon--call" href={call} aria-label={`Call ${label}`}>
            <Phone size={17} />
          </a>
        ) : (
          <span className="dealers-create-phone__icon dealers-create-phone__icon--call is-disabled" aria-hidden>
            <Phone size={17} />
          </span>
        )}
        {chat ? (
          <a
            className="dealers-create-phone__icon dealers-create-phone__icon--wa"
            href={chat}
            target="_blank"
            rel="noreferrer"
            aria-label={`WhatsApp ${label}`}
          >
            <WhatsAppGlyph />
          </a>
        ) : (
          <span className="dealers-create-phone__icon dealers-create-phone__icon--wa is-disabled" aria-hidden>
            <WhatsAppGlyph />
          </span>
        )}
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="dealers-detail__field dealers-detail__toggle">
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

interface CreateDealerModalProps {
  onClose: () => void;
  onCreated: (dealer: ZohoDealer) => void;
}

export const CreateDealerModal: React.FC<CreateDealerModalProps> = ({
  onClose,
  onCreated,
}) => {
  const { user } = useAuth();
  const [gstin, setGstin] = useState('');
  const [gstFetchStatus, setGstFetchStatus] = useState<'idle' | 'error' | 'success'>('idle');
  const [companyName, setCompanyName] = useState('');
  const [gstTreatment, setGstTreatment] = useState('');
  const [taxpayerType, setTaxpayerType] = useState('');
  const [constitutionOfBusiness, setConstitutionOfBusiness] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [panNo, setPanNo] = useState('');
  const [contactName, setContactName] = useState('');
  const [shopMobile, setShopMobile] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [dealerStage, setDealerStage] = useState('Active');
  const [assignedStaffUid, setAssignedStaffUid] = useState('');
  const [billing, setBilling] = useState<DealerAddress>(emptyDealerAddress);
  const [shipping, setShipping] = useState<DealerAddress>(emptyDealerAddress);
  const [separateShipping, setSeparateShipping] = useState(false);
  const [priceLevelId, setPriceLevelId] = useState('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [canBuySpares, setCanBuySpares] = useState(true);
  const [orderPayOffline, setOrderPayOffline] = useState(true);
  const [orderPayOnline, setOrderPayOnline] = useState(false);
  const [assignableStaff, setAssignableStaff] = useState<AssignableStaffOption[]>([]);
  const [priceLevels, setPriceLevels] = useState<PriceLevel[]>([]);
  const [gstFetching, setGstFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createPhase, setCreatePhase] = useState<DealerCreateStatusPhase | null>(null);
  const [error, setError] = useState('');

  const taxpayerOptions = withFetchedOption(GST_TAXPAYER_TYPES, taxpayerType);
  const constitutionOptions = withFetchedOption(GST_CONSTITUTIONS, constitutionOfBusiness);

  useEffect(() => {
    void listAssignableDealerStaff()
      .then(setAssignableStaff)
      .catch(err => console.error('Create dealer staff load failed:', err));
  }, []);

  useEffect(() => subscribePriceLevels(docData => {
    setPriceLevels(docData.levels);
    setPriceLevelId(current => current || docData.levels.find(isDefaultDealerPriceLevel)?.id || '');
  }), []);

  const applyBilling = (next: DealerAddress, keepSeparate = separateShipping) => {
    setBilling(next);
    if (!keepSeparate) setShipping(next);
  };

  const handleGstinFetch = async () => {
    const next = normalizeGstin(gstin);
    setGstin(next);
    if (!GSTIN_FORMAT.test(next)) {
      setError('Enter a valid 15-character GSTIN.');
      setGstFetchStatus('error');
      return;
    }
    setGstFetching(true);
    setError('');
    try {
      const details = await fetchGstinDetails(next);
      setCompanyName(details.companyName || details.tradeName || details.legalName);
      setTradeName(details.tradeName || details.companyName);
      setLegalName(details.legalName);
      setGstTreatment(details.gstTreatment || 'business_gst');
      setTaxpayerType(details.taxpayerType);
      setConstitutionOfBusiness(details.constitutionOfBusiness);
      setPanNo(current => current.trim() || panFromGstin(next));
      setBilling(current => {
        const nextBilling = {
          ...current,
          address: details.address || current.address,
          street2: details.street2 || current.street2,
          state: details.state || current.state,
          district: details.district || current.district,
          city: details.city || details.district || current.city,
          zip: details.zip || current.zip,
          country: current.country || 'India',
          phone: current.phone || details.phone.replace(/\D/g, '').slice(-10),
        };
        if (!separateShipping) setShipping(nextBilling);
        return nextBilling;
      });
      if (details.phone) {
        setShopMobile(current => current.trim() || details.phone.replace(/\D/g, '').slice(-10));
      }
      setGstFetchStatus('success');
    } catch (err) {
      setGstFetchStatus('error');
      setError(dealerErrorMessage(err));
    } finally {
      setGstFetching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const company = companyName.trim() || tradeName.trim() || legalName.trim();
    if (!company) {
      setError('Shop / company name is required.');
      return;
    }
    const shop = shopMobile.trim() ? normalizePhone(shopMobile) : '';
    const person = mobile.trim() ? normalizePhone(mobile) : '';
    if (!shop && !person) {
      setError('Enter shop mobile or mobile.');
      return;
    }
    if (shopMobile.trim() && !isValidPhone(shop)) {
      setError('Enter a valid 10-digit shop mobile.');
      return;
    }
    if (mobile.trim() && !isValidPhone(person)) {
      setError('Enter a valid 10-digit mobile.');
      return;
    }
    const mail = email.trim().toLowerCase();
    if (mail && !EMAIL_FORMAT.test(mail)) {
      setError('Enter a valid email address.');
      return;
    }
    const gst = normalizeGstin(gstin);
    if (gst && !GSTIN_FORMAT.test(gst)) {
      setError('Enter a valid 15-character GSTIN.');
      setGstFetchStatus('error');
      return;
    }
    const pan = panNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (pan && !PAN_FORMAT.test(pan)) {
      setError('Enter a valid 10-character PAN.');
      return;
    }
    const nextShipping = separateShipping ? shipping : billing;
    unlockDealerActionAudio();
    setSubmitting(true);
    setCreatePhase('creating');
    setError('');
    try {
      const dealer = await createDealer({
        companyName: company,
        contactName: contactName.trim() || undefined,
        phone: shop || undefined,
        mobile: person || undefined,
        email: mail || undefined,
        gstin: gst || undefined,
        gstTreatment: gstTreatment.trim() || undefined,
        legalName: legalName.trim() || undefined,
        taxpayerType: taxpayerType.trim() || undefined,
        constitutionOfBusiness: constitutionOfBusiness.trim() || undefined,
        pan: pan || undefined,
        dealerStage: dealerStage.trim() || undefined,
        assignedStaffUid: assignedStaffUid.trim() || undefined,
        googleMapsUrl: googleMapsUrl.trim() || undefined,
        canBuySpares,
        orderPayOffline,
        orderPayOnline,
        billingState: billing.state || undefined,
        district: billing.district || undefined,
        zipCode: billing.zip || undefined,
        billingAddress: formatDealerAddress(billing) || undefined,
        shippingAddress: formatDealerAddress(nextShipping) || undefined,
        billing,
        shipping: nextShipping,
        sameShipping: !separateShipping,
      });
      try {
        await patchDealer(dealer.id, {
          email: mail || null,
          dealerStage: dealerStage.trim() || null,
          assignedStaffUid: assignedStaffUid.trim() || null,
          googleMapsUrl: googleMapsUrl.trim() || null,
          canBuySpares,
          orderPayOffline,
          orderPayOnline,
          zipCode: billing.zip || null,
          billingState: billing.state || null,
          district: billing.district || null,
          billingAddress: formatDealerAddress(billing) || null,
          shippingAddress: formatDealerAddress(nextShipping) || null,
          zohoPanNo: pan || null,
          zohoBillingAddressRaw: dealerAddressToZoho(billing),
          zohoShippingAddressRaw: dealerAddressToZoho(nextShipping),
        });
      } catch (err) {
        console.error('Create dealer extras patch failed:', err);
      }
      if (priceLevelId && !isDefaultDealerPriceLevel(priceLevelId)) {
        try {
          await savePriceLevels(
            assignDealerToPriceLevel(priceLevels, dealer.id, priceLevelId),
            user?.uid ?? null,
          );
        } catch (err) {
          console.error('Create dealer price level failed:', err);
        }
      }
      const staged: ZohoDealer = {
        ...dealer,
        dealerStage: dealerStage.trim() || dealer.dealerStage || 'Active',
        email: mail || dealer.email,
        assignedStaffUid: assignedStaffUid.trim() || dealer.assignedStaffUid,
      };
      upsertCachedDealer(staged);
      setCreatePhase('success');
      playDealerSuccessSound();
      window.setTimeout(() => onCreated(staged), 1100);
    } catch (err) {
      setCreatePhase('fail');
      playDealerFailSound();
      setError(dealerErrorMessage(err));
      window.setTimeout(() => setCreatePhase(current => (current === 'fail' ? null : current)), 1600);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dealers-modal-backdrop dealers-create-backdrop" onClick={onClose}>
      <div
        className="dealers-modal dealers-create-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-labelledby="create-dealer-title"
      >
        <div className="dealers-modal__header">
          <h2 id="create-dealer-title">Add dealer</h2>
          <button type="button" className="dealers-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="dealers-modal__form" onSubmit={e => void handleSubmit(e)}>
          <section className="dealers-create-gstin">
            <h3>GSTIN</h3>
            <div className={`dealers-create-gstin__row${gstFetchStatus === 'error' ? ' is-bad' : ''}${gstFetchStatus === 'success' ? ' is-ok' : ''}`}>
              <input
                type="text"
                value={gstin}
                maxLength={15}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                placeholder="15-DIGIT GSTIN"
                aria-label="GSTIN"
                onChange={e => {
                  setGstFetchStatus('idle');
                  setGstin(e.target.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase());
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleGstinFetch();
                  }
                }}
              />
              <button
                type="button"
                className={`btn btn-primary dealers-create-gstin__fetch${gstFetchStatus === 'success' ? ' is-ok' : ''}`}
                onClick={() => void handleGstinFetch()}
                disabled={gstFetching || submitting}
              >
                {gstFetching ? (
                  <RefreshCw size={15} className="spin-icon" />
                ) : gstFetchStatus === 'success' ? (
                  <Check size={16} strokeWidth={2.8} />
                ) : (
                  <RefreshCw size={15} />
                )}
                {gstFetching ? 'Fetching…' : gstFetchStatus === 'success' ? 'Fetched' : 'Fetch'}
              </button>
            </div>
          </section>

          <section className="dealers-create-details">
            <h3>Details</h3>
            <label className="dealers-modal__field">
              <span>Shop / Company name</span>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="Shop / company name"
                required
              />
            </label>
            <label className="dealers-modal__field">
              <span>GST treatment</span>
              <select value={gstTreatment} onChange={e => setGstTreatment(e.target.value)}>
                {GST_TREATMENTS.map(row => (
                  <option key={row.id || 'none'} value={row.id}>{row.label}</option>
                ))}
              </select>
            </label>
            <label className="dealers-modal__field">
              <span>Taxpayer type</span>
              <select value={taxpayerType} onChange={e => setTaxpayerType(e.target.value)}>
                <option value="">Not set</option>
                {taxpayerOptions.map(row => (
                  <option key={row} value={row}>{row}</option>
                ))}
              </select>
            </label>
            <label className="dealers-modal__field">
              <span>Business constitution type</span>
              <select value={constitutionOfBusiness} onChange={e => setConstitutionOfBusiness(e.target.value)}>
                <option value="">Not set</option>
                {constitutionOptions.map(row => (
                  <option key={row} value={row}>{row}</option>
                ))}
              </select>
            </label>
            <label className="dealers-modal__field">
              <span>Business legal name</span>
              <input
                type="text"
                value={legalName}
                onChange={e => setLegalName(e.target.value.toUpperCase())}
                placeholder="Legal name"
              />
            </label>
            <label className="dealers-modal__field">
              <span>Business trade name</span>
              <input
                type="text"
                value={tradeName}
                onChange={e => setTradeName(e.target.value.toUpperCase())}
                placeholder="Trade name"
              />
            </label>
            <label className="dealers-modal__field">
              <span>PAN</span>
              <input
                type="text"
                value={panNo}
                maxLength={10}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={e => setPanNo(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                placeholder="10-character PAN"
              />
            </label>
            <label className="dealers-modal__field">
              <span>Contact person name</span>
              <input
                type="text"
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                placeholder="Contact person"
              />
            </label>
            <PhoneField
              id="create-dealer-shop-mobile"
              label="Shop mobile *"
              value={shopMobile}
              placeholder="10-digit shop mobile"
              onChange={setShopMobile}
            />
            <PhoneField
              id="create-dealer-mobile"
              label="Mobile *"
              value={mobile}
              placeholder="10-digit mobile"
              onChange={setMobile}
            />
            <p className="dealers-create-phone-hint">Enter shop mobile or mobile — one is enough.</p>
            <label className="dealers-modal__field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </label>
            <label className="dealers-modal__field">
              <span>Status</span>
              <select value={dealerStage} onChange={e => setDealerStage(e.target.value)}>
                <option value="">Unset</option>
                {DEALER_STAGES.map(stage => (
                  <option key={stage} value={stage}>{stage}</option>
                ))}
              </select>
            </label>
            <label className="dealers-modal__field">
              <span>KAM</span>
              <select value={assignedStaffUid} onChange={e => setAssignedStaffUid(e.target.value)}>
                <option value="">Unassigned</option>
                {dealerStaffSelectOptions(assignableStaff).map(staff => (
                  <option key={staff.uid} value={staff.uid}>{staff.displayName}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="dealers-create-details">
            <h3>Address</h3>
            {!separateShipping ? (
              <DealerAddressBox
                idPrefix="create-billing"
                title="Billing and shipping address is same"
                value={billing}
                disabled={submitting}
                onChange={next => applyBilling(next, false)}
                extra={(
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={submitting}
                    onClick={() => setSeparateShipping(true)}
                  >
                    Different shipping
                  </button>
                )}
              />
            ) : (
              <>
                <DealerAddressBox
                  idPrefix="create-billing"
                  title="Billing address"
                  value={billing}
                  disabled={submitting}
                  onChange={next => applyBilling(next, true)}
                />
                <DealerAddressBox
                  idPrefix="create-shipping"
                  title="Shipping address"
                  value={shipping}
                  disabled={submitting}
                  onChange={setShipping}
                  extra={(
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={submitting}
                      onClick={() => {
                        applyBilling(billing, false);
                        setSeparateShipping(false);
                      }}
                    >
                      <Copy size={14} />
                      Same as billing
                    </button>
                  )}
                />
              </>
            )}
          </section>

          <section className="dealers-create-details dealers-create-more">
            <h3>More</h3>
            <label className="dealers-modal__field">
              <span>Price level</span>
              <select
                value={priceLevelId}
                disabled={submitting || priceLevels.length === 0}
                onChange={e => setPriceLevelId(e.target.value)}
              >
                {priceLevels.length === 0 ? (
                  <option value="">Loading…</option>
                ) : (
                  priceLevels.map(level => (
                    <option key={level.id} value={level.id}>{level.name}</option>
                  ))
                )}
              </select>
            </label>
            <label className="dealers-modal__field">
              <span>Google Maps link</span>
              <div className="dealers-detail__link-field">
                <input
                  type="url"
                  value={googleMapsUrl}
                  onChange={e => setGoogleMapsUrl(e.target.value)}
                  placeholder="https://maps.google.com/…"
                />
                {googleMapsUrl.trim() ? (
                  <a
                    href={googleMapsUrl}
                    className="dealers-detail__link-open"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open map"
                  >
                    <ExternalLink size={16} />
                  </a>
                ) : null}
              </div>
            </label>
            <ToggleField
              label="Can buy spare parts"
              checked={canBuySpares}
              disabled={submitting}
              onChange={setCanBuySpares}
            />
            <ToggleField
              label="Order online · pay offline"
              checked={orderPayOffline}
              disabled={submitting}
              onChange={setOrderPayOffline}
            />
            <ToggleField
              label="Order and pay online"
              checked={orderPayOnline}
              disabled={submitting}
              onChange={setOrderPayOnline}
            />
          </section>

          {error ? <p className="dealers-modal__error">{error}</p> : null}
          <button type="submit" className="btn btn-primary dealers-create-submit" disabled={submitting}>
            <Save size={16} />
            {submitting ? 'Creating…' : 'Create dealer'}
          </button>
        </form>
        {createPhase ? <DealerCreateStatusOverlay phase={createPhase} /> : null}
      </div>
    </div>
  );
};
