import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Phone } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { DealerStatusCell } from '../../components/dealers/DealerStatusCell';
import { MultiSelect } from '../../components/dealers/MultiSelect';
import { getDealerStatusMeta } from '../../lib/dealerStatus';
import {
  dealerErrorMessage,
  fetchDealerById,
  fetchDealerCategories,
  fetchDealerLocations,
  fetchKams,
  patchDealer,
} from '../../lib/dealers';
import { buildContactLinks } from '../../lib/phoneLinks';
import type { Kam, ZohoDealer } from '../../types/dealers';
import { DEALER_STAGES } from '../../types/dealers';

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.274-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="dealers-detail__row">
      <span className="dealers-detail__label">{label}</span>
      <span className="dealers-detail__value">{value || '—'}</span>
    </div>
  );
}

export const DealerDetailPage: React.FC = () => {
  const { dealerId } = useParams<{ dealerId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const listPath = location.pathname.replace(/\/[^/]+$/, '');
  const preview = (location.state as { dealer?: ZohoDealer } | null)?.dealer;

  const [dealer, setDealer] = useState<ZohoDealer | null>(
    preview && preview.id === dealerId ? preview : null,
  );
  const [kams, setKams] = useState<Kam[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [loading, setLoading] = useState(!dealer);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (!dealer?.billingState) {
      setDistricts([]);
      return;
    }
    void fetchDealerLocations().then(res => {
      setDistricts(res.districtsByState[dealer.billingState ?? ''] ?? []);
    });
  }, [dealer?.billingState]);

  const updateField = async (patch: Partial<ZohoDealer>, options?: { quiet?: boolean }) => {
    if (!dealer) return;
    if (!options?.quiet) setSaving(true);
    setError('');
    try {
      await patchDealer(dealer.id, patch);
      setDealer(prev => (prev ? { ...prev, ...patch } : prev));
      try {
        const refreshed = await fetchDealerById(dealer.id);
        setDealer(refreshed);
        setError('');
      } catch {
        // Keep optimistic update if refresh fails (e.g. getDealer not deployed yet).
      }
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      if (!options?.quiet) setSaving(false);
    }
  };

  if (!dealerId) return null;

  const name = dealer ? (dealer.companyName || dealer.contactName) : '';
  const phone = dealer ? (dealer.phone || dealer.mobile) : null;
  const contactLinks = phone ? buildContactLinks(phone) : null;
  const statusMeta = dealer ? getDealerStatusMeta(dealer) : null;

  return (
    <div className="page-content fade-in dealers-detail-page">
      <button
        type="button"
        className="dealers-detail__back catalog-filters__back-btn"
        onClick={() => navigate(listPath)}
      >
        <ArrowLeft size={18} aria-hidden />
        <span>Back to dealers</span>
      </button>

      {error && (
        <div className="products-inline-error panel glass">
          <span>{error}</span>
        </div>
      )}

      {loading && !dealer ? (
        <div className="dealers-detail panel glass">
          <p className="text-muted">Loading dealer…</p>
        </div>
      ) : !dealer ? (
        <div className="dealers-detail panel glass">
          <p className="text-muted">Dealer not found.</p>
        </div>
      ) : (
        <>
          <div className="dealers-detail panel glass">
            <h3 className="dealers-detail__section-title">Dealer</h3>
            <div className="dealers-detail__readonly">
              <DetailRow label="Company" value={name} />
            </div>
          </div>

          <div className="dealers-detail panel glass">
            <h3 className="dealers-detail__section-title">Status</h3>
            <div className="dealers-detail__status-edit">
              <DealerStatusCell
                dealer={dealer}
                onStageChange={stage => void updateField({ dealerStage: stage })}
              />
              <span className="text-muted text-sm">{statusMeta?.label}</span>
            </div>
          </div>

          <div className="dealers-detail panel glass">
            <h3 className="dealers-detail__section-title">Assignment</h3>
            <div className="dealers-detail__form">
              <label className="dealers-detail__field">
                <span>KAM</span>
                <select
                  className="catalog-select"
                  value={dealer.kamId ?? ''}
                  disabled={saving}
                  onChange={e => void updateField({ kamId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {kams.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </label>
              <label className="dealers-detail__field dealers-detail__field--full">
                <span>Category</span>
                <MultiSelect
                  placeholder="Select categories"
                  menuPortal
                  value={dealer.categories}
                  options={categories.map(c => ({ value: c, label: c }))}
                  onChange={next => {
                    setDealer(d => d ? { ...d, categories: next } : d);
                    void updateField({ categories: next }, { quiet: true });
                  }}
                />
              </label>
              <label className="dealers-detail__field">
                <span>Stage</span>
                <select
                  className="catalog-select"
                  value={dealer.dealerStage ?? ''}
                  disabled={saving}
                  onChange={e => void updateField({ dealerStage: e.target.value || null })}
                >
                  <option value="">Unset</option>
                  {DEALER_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="dealers-detail panel glass">
            <h3 className="dealers-detail__section-title">Contact</h3>
            <div className="dealers-detail__form">
              <label className="dealers-detail__field">
                <span>Contact name</span>
                <input
                  className="input-field"
                  value={dealer.firstName ?? ''}
                  disabled={saving}
                  onChange={e => setDealer(d => d ? { ...d, firstName: e.target.value } : d)}
                  onBlur={e => void updateField({ firstName: e.target.value || null })}
                />
              </label>
              <label className="dealers-detail__field">
                <span>Phone</span>
                <input
                  className="input-field"
                  value={dealer.phone ?? dealer.mobile ?? ''}
                  disabled={saving}
                  onChange={e => setDealer(d => d ? { ...d, phone: e.target.value } : d)}
                  onBlur={e => void updateField({ phone: e.target.value || null })}
                />
              </label>
            </div>
            {contactLinks && (
              <div className="dealers-detail__contact-actions">
                <a href={contactLinks.tel} className="btn btn-secondary btn-sm">
                  <Phone size={15} />
                  Call
                </a>
                <a
                  href={contactLinks.whatsapp}
                  className="btn btn-secondary btn-sm"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <WhatsAppIcon />
                  WhatsApp
                </a>
              </div>
            )}
            <div className="dealers-detail__readonly">
              <DetailRow label="Email" value={dealer.email} />
              <DetailRow label="Zoho contact" value={dealer.contactName} />
            </div>
          </div>

          <div className="dealers-detail panel glass">
            <h3 className="dealers-detail__section-title">Location</h3>
            <div className="dealers-detail__form">
              <label className="dealers-detail__field">
                <span>Pincode</span>
                <input
                  className="input-field"
                  value={dealer.zipCode ?? ''}
                  disabled={saving}
                  onChange={e => setDealer(d => d ? { ...d, zipCode: e.target.value } : d)}
                  onBlur={e => void updateField({ zipCode: e.target.value || null })}
                />
              </label>
              <label className="dealers-detail__field">
                <span>State</span>
                <select
                  className="catalog-select"
                  value={dealer.billingState ?? ''}
                  disabled={saving}
                  onChange={e => void updateField({
                    billingState: e.target.value || null,
                    district: null,
                  })}
                >
                  <option value="">—</option>
                  {states.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="dealers-detail__field">
                <span>District</span>
                <select
                  className="catalog-select"
                  value={dealer.district ?? ''}
                  disabled={saving || !dealer.billingState}
                  onChange={e => void updateField({ district: e.target.value || null })}
                >
                  <option value="">—</option>
                  {districts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="dealers-detail panel glass">
            <h3 className="dealers-detail__section-title">Account</h3>
            <div className="dealers-detail__readonly">
              <DetailRow label="Signed in" value={dealer.signedIn ? 'Yes' : 'No'} />
              <DetailRow label="Portal user" value={dealer.portalUserName} />
              <DetailRow label="Zoho status" value={dealer.status} />
              <DetailRow
                label="Outstanding"
                value={dealer.outstandingReceivable?.toLocaleString('en-IN')}
              />
              <DetailRow label="Last synced" value={dealer.syncedAt ? new Date(dealer.syncedAt).toLocaleString() : null} />
              <DetailRow label="Zoho ID" value={dealer.id} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
