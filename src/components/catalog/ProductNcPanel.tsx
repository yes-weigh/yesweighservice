import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  addCatalogNcLine,
  deleteCatalogNcPhoto,
  getCatalogProductNc,
  resolveCatalogNcLine,
  resolveNcSiteForProduct,
  uploadCatalogNcPhoto,
  wipeCatalogProductNc,
} from '../../lib/catalogNc/data';
import { CATALOG_INVENTORY_SITE_CONFIG } from '../../lib/catalogInventorySites';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import type { CatalogInventorySite } from '../../types/catalog-site-inventory';
import type {
  CatalogNcDoc,
  CatalogNcLine,
  CatalogNcLocation,
  CatalogNcLocationKey,
  CatalogNcPhoto,
  NcReasonCode,
  NcResolveOutcome,
} from '../../types/catalog-nc';
import {
  MAX_NC_PHOTOS_PER_LINE,
  NC_REASON_OPTIONS,
  NC_RESOLVE_OUTCOMES,
  ncLocationKey,
} from '../../types/catalog-nc';
import { ProductNcSelect } from './ProductNcSelect';
import { ProductNcLocationPicker } from './ProductNcLocationPicker';

export interface ProductNcExistingLocation {
  key: string;
  site: CatalogInventorySite;
  label: string;
  auditedQty: number;
  location: CatalogNcLocationKey;
}

export interface ProductNcPanelProps {
  product: CatalogProduct;
  categories: CatalogCategory[];
  open: boolean;
  onClose?: () => void;
  canEdit: boolean;
  /** Super admin only — permanently wipe all NC data for this product. */
  canWipeNc?: boolean;
  actorUid: string;
  actorName?: string | null;
  /** Existing Cochin / Head Office locations already recorded for this item. */
  existingLocations?: ProductNcExistingLocation[];
  onNcChange?: (doc: CatalogNcDoc | null) => void;
  /** When true, hide the close button (used inside product detail tabs). */
  embedded?: boolean;
  /** Expand this open NC line when the panel opens. */
  focusLineId?: string | null;
}

export const ProductNcPanel: React.FC<ProductNcPanelProps> = ({
  product,
  categories,
  open,
  onClose,
  canEdit,
  canWipeNc = false,
  actorUid,
  actorName,
  existingLocations = [],
  onNcChange,
  embedded = false,
  focusLineId = null,
}) => {
  const site = useMemo(
    () => resolveNcSiteForProduct(product, categories),
    [product, categories],
  );
  const siteConfig = CATALOG_INVENTORY_SITE_CONFIG[site];

  const siteLocations = useMemo(
    () => existingLocations.filter(loc => loc.site === site),
    [existingLocations, site],
  );

  const [docData, setDocData] = useState<CatalogNcDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  const [draftLocation, setDraftLocation] = useState<CatalogNcLocationKey | null>(null);
  const [qty, setQty] = useState('1');
  const [reasonCode, setReasonCode] = useState<NcReasonCode>('display_issue');
  const [reasonText, setReasonText] = useState('');
  const [photos, setPhotos] = useState<CatalogNcPhoto[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [resolveTarget, setResolveTarget] = useState<{
    location: CatalogNcLocation;
    line: CatalogNcLine;
  } | null>(null);
  const [resolveQty, setResolveQty] = useState('1');
  const [resolveOutcome, setResolveOutcome] = useState<NcResolveOutcome>('repaired');
  const [resolveNote, setResolveNote] = useState('');
  const [wiping, setWiping] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCatalogProductNc(product.id);
      setDocData(data);
      onNcChange?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load NC records.');
    } finally {
      setLoading(false);
    }
  }, [product.id, onNcChange]);

  useEffect(() => {
    if (!open) return;
    void load();
    setShowAddForm(false);
    setResolveTarget(null);
    setDraftLocation(null);
  }, [open, load]);

  const auditedQtyForDraft = useMemo(() => {
    if (!draftLocation) return null;
    const key = (() => {
      try {
        return ncLocationKey({ ...draftLocation, site });
      } catch {
        return '';
      }
    })();
    return siteLocations.find(loc => loc.key === key)?.auditedQty ?? null;
  }, [draftLocation, site, siteLocations]);

  const openLines = useMemo(() => {
    if (!docData) return [];
    return docData.locations.flatMap(location => (
      location.lines
        .filter(line => line.status === 'open')
        .map(line => ({ location, line }))
    ));
  }, [docData]);

  useEffect(() => {
    if (!open || !focusLineId || openLines.length === 0) return;
    const match = openLines.find(({ line }) => line.id === focusLineId);
    if (!match) return;
    setShowAddForm(false);
    setResolveTarget({ location: match.location, line: match.line });
    setResolveQty(String(match.line.qty));
    setResolveOutcome('repaired');
    setResolveNote('');
  }, [open, focusLineId, openLines]);

  const historyEvents = useMemo(
    () => [...(docData?.events ?? [])]
      .filter(event => event.type !== 'location_added')
      .sort((a, b) => b.at.localeCompare(a.at)),
    [docData],
  );

  const startResolve = (location: CatalogNcLocation, line: CatalogNcLine) => {
    setShowAddForm(false);
    setResolveTarget({ location, line });
    setResolveQty(String(line.qty));
    setResolveOutcome('repaired');
    setResolveNote('');
    setError(null);
  };

  const cancelResolve = () => {
    setResolveTarget(null);
    setResolveNote('');
  };

  const openAddForm = () => {
    setShowAddForm(true);
    setResolveTarget(null);
    setDraftLocation(null);
    setError(null);
    setWarnings([]);
  };

  const closeAddForm = () => {
    setShowAddForm(false);
    setDraftLocation(null);
    setWarnings([]);
  };

  const handlePhotoPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || photos.length >= MAX_NC_PHOTOS_PER_LINE) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const photo = await uploadCatalogNcPhoto(product.id, file);
      setPhotos(prev => [...prev, photo].slice(0, MAX_NC_PHOTOS_PER_LINE));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = async (photo: CatalogNcPhoto) => {
    setPhotos(prev => prev.filter(p => p.id !== photo.id));
    await deleteCatalogNcPhoto(photo);
  };

  const handleAddLine = async () => {
    if (!canEdit || saving) return;
    if (!draftLocation) {
      setError('Select a storage location.');
      return;
    }
    setSaving(true);
    setError(null);
    setWarnings([]);
    try {
      const result = await addCatalogNcLine({
        catalogProductId: product.id,
        site,
        location: draftLocation,
        qty: Number(qty),
        reasonCode,
        reasonText,
        photos,
        actorUid,
        actorName,
        auditedQtyAtLocation: auditedQtyForDraft,
        zohoStock: product.stock,
      });
      setDocData(result.doc);
      onNcChange?.(result.doc);
      setWarnings(result.warnings);
      setQty('1');
      setReasonText('');
      setPhotos([]);
      setDraftLocation(null);
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save NC.');
    } finally {
      setSaving(false);
    }
  };

  const handleResolve = async () => {
    if (!canEdit || !resolveTarget || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await resolveCatalogNcLine({
        catalogProductId: product.id,
        locationId: resolveTarget.location.id,
        lineId: resolveTarget.line.id,
        resolveQty: Number(resolveQty),
        outcome: resolveOutcome,
        note: resolveNote,
        actorUid,
        actorName,
      });
      setDocData(saved);
      onNcChange?.(saved);
      setResolveTarget(null);
      setResolveNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve NC.');
    } finally {
      setSaving(false);
    }
  };

  const handleWipeNc = async () => {
    if (!canWipeNc || wiping || !docData) return;
    const confirmed = window.confirm(
      'Wipe all NC data for this product? This permanently deletes open lines, history, and photos.',
    );
    if (!confirmed) return;
    setWiping(true);
    setError(null);
    setWarnings([]);
    try {
      await wipeCatalogProductNc(product.id);
      setDocData(null);
      onNcChange?.(null);
      setShowAddForm(false);
      setResolveTarget(null);
      setPhotos([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not wipe NC data.');
    } finally {
      setWiping(false);
    }
  };

  if (!open) return null;

  return (
    <div className={`product-nc-panel panel glass${embedded ? ' product-nc-panel--embedded' : ''}`}>
      <div className="product-nc-panel__head">
        <div>
          <h2 className="product-nc-panel__title">Non-Conformance (NC)</h2>
          <p className="product-nc-panel__subtitle text-muted text-sm">
            {siteConfig.warehouseName}
            {' · '}
            Open: <strong>{docData?.openNcQty ?? 0}</strong>
          </p>
        </div>
        <div className="product-nc-panel__head-actions">
          {canEdit && (
            <button
              type="button"
              className={`btn btn-sm${showAddForm ? '' : ' btn-primary'}`}
              onClick={() => (showAddForm ? closeAddForm() : openAddForm())}
              aria-expanded={showAddForm}
              disabled={wiping}
            >
              {showAddForm ? <X size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
              {showAddForm ? 'Close' : 'Add NC'}
            </button>
          )}
          {canWipeNc && docData && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => void handleWipeNc()}
              disabled={wiping || saving}
              title="Permanently delete all NC data for this product"
            >
              <Trash2 size={14} aria-hidden />
              {wiping ? 'Wiping…' : 'Wipe NC'}
            </button>
          )}
          {!embedded && onClose && (
            <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close NC">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {error && <p className="product-nc-panel__error text-sm">{error}</p>}
      {warnings.map(warning => (
        <p key={warning} className="product-nc-panel__warning text-sm">
          <AlertTriangle size={14} aria-hidden />
          {warning}
        </p>
      ))}

      {loading ? (
        <p className="text-muted text-sm">Loading NC…</p>
      ) : (
        <>
          {canEdit && showAddForm && (
            <section className="product-nc-panel__add" aria-label="Add NC">
              <h3>Add NC</h3>
              <div className="product-nc-panel__form-grid">
                <ProductNcLocationPicker
                  site={site}
                  value={draftLocation}
                  onChange={setDraftLocation}
                  disabled={saving}
                />
                <label>
                  <span>Qty</span>
                  <input type="number" min={1} step={1} value={qty} onChange={e => setQty(e.target.value)} />
                </label>
                <label>
                  <span>Reason</span>
                  <ProductNcSelect
                    aria-label="Reason"
                    value={reasonCode}
                    onChange={value => setReasonCode(value as NcReasonCode)}
                    options={NC_REASON_OPTIONS.map(option => ({
                      value: option.key,
                      label: option.label,
                    }))}
                  />
                </label>
                {reasonCode === 'other' && (
                  <label className="product-nc-panel__span">
                    <span>Other note</span>
                    <input
                      value={reasonText}
                      onChange={e => setReasonText(e.target.value)}
                      placeholder="Describe the issue"
                    />
                  </label>
                )}
                {auditedQtyForDraft != null && (
                  <p className="text-muted text-sm product-nc-panel__span">
                    Audited at this location: {auditedQtyForDraft} {product.unit}
                  </p>
                )}
              </div>

              <div className="product-nc-panel__photos">
                {photos.map(photo => (
                  <div key={photo.id} className="product-nc-panel__photo">
                    <img src={photo.url} alt="" />
                    <button type="button" onClick={() => void removePhoto(photo)} aria-label="Remove photo">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {photos.length < MAX_NC_PHOTOS_PER_LINE && (
                  <label className="product-nc-panel__photo-add">
                    {uploadingPhoto ? <RefreshCw size={14} className="spin-icon" /> : <Camera size={14} />}
                    <span>Photo</span>
                    <input type="file" accept="image/*" hidden onChange={e => void handlePhotoPick(e)} />
                  </label>
                )}
              </div>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={saving || uploadingPhoto || !draftLocation}
                onClick={() => void handleAddLine()}
              >
                {saving ? <RefreshCw size={14} className="spin-icon" /> : <Plus size={14} />}
                Add NC line
              </button>
            </section>
          )}

          <section className="product-nc-panel__section" aria-label="Open NC">
            <div className="product-nc-panel__section-head">
              <h3>Open NC</h3>
              <span className="product-nc-panel__section-count">{openLines.length}</span>
            </div>

            {openLines.length === 0 ? (
              <p className="text-muted text-sm">No open NC for this item.</p>
            ) : (
              <div className="product-site-stock__table-wrap product-site-stock__table-wrap--warehouse product-nc-panel__open-table-wrap">
                <table className="product-site-stock__table product-site-stock__table--hero-values product-nc-panel__open-table">
                  <thead>
                    <tr>
                      <th className="product-nc-panel__th-photo">Photo</th>
                      {site === 'cochin' ? (
                        <>
                          <th>Zone</th>
                          <th>Row</th>
                        </>
                      ) : (
                        <>
                          <th>Rack</th>
                          <th>Row</th>
                          <th>Bin</th>
                        </>
                      )}
                      <th>Qty</th>
                      {canEdit && <th className="product-nc-panel__th-action" />}
                    </tr>
                  </thead>
                  <tbody>
                    {openLines.map(({ location, line }) => {
                      const isResolving = resolveTarget?.line.id === line.id;
                      const photo = line.photos[0] ?? null;
                      const locationCols = site === 'cochin' ? 2 : 3;
                      const resolveColSpan = 1 + locationCols + 1 + (canEdit ? 1 : 0);
                      return (
                        <React.Fragment key={line.id}>
                          <tr className={isResolving ? 'product-nc-panel__open-row--active' : undefined}>
                            <td className="product-nc-panel__td-photo">
                              {photo ? (
                                <button
                                  type="button"
                                  className="product-nc-panel__thumb-btn"
                                  onClick={() => setLightboxUrl(photo.url)}
                                  aria-label="View NC photo"
                                >
                                  <img
                                    className="product-nc-panel__thumb"
                                    src={photo.url}
                                    alt=""
                                  />
                                </button>
                              ) : (
                                <span className="product-nc-panel__thumb product-nc-panel__thumb--empty">—</span>
                              )}
                            </td>
                            {site === 'cochin' ? (
                              <>
                                <td>{(location.zoneId ?? '').trim().toUpperCase() || '—'}</td>
                                <td>{location.zoneRowNumber ?? '—'}</td>
                              </>
                            ) : (
                              <>
                                <td>{(location.rackId ?? '').trim().toUpperCase() || '—'}</td>
                                <td>{location.rowNumber ?? '—'}</td>
                                <td>{location.binNumber ?? '—'}</td>
                              </>
                            )}
                            <td className="product-nc-panel__td-qty">{line.qty}</td>
                            {canEdit && (
                              <td className="product-nc-panel__td-action">
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => (
                                    isResolving ? cancelResolve() : startResolve(location, line)
                                  )}
                                >
                                  <CheckCircle2 size={14} aria-hidden />
                                  {isResolving ? 'Cancel' : 'Resolve'}
                                </button>
                              </td>
                            )}
                          </tr>
                          {canEdit && isResolving && (
                            <tr className="product-nc-panel__resolve-row">
                              <td colSpan={resolveColSpan}>
                                <div className="product-nc-panel__resolve-inline">
                                  <div className="product-nc-panel__form-grid">
                                    <label>
                                      <span>Qty to resolve</span>
                                      <input
                                        type="number"
                                        min={1}
                                        max={line.qty}
                                        value={resolveQty}
                                        onChange={e => setResolveQty(e.target.value)}
                                      />
                                    </label>
                                    <label>
                                      <span>Outcome</span>
                                      <ProductNcSelect
                                        aria-label="Outcome"
                                        value={resolveOutcome}
                                        onChange={value => setResolveOutcome(value as NcResolveOutcome)}
                                        options={NC_RESOLVE_OUTCOMES.map(option => ({
                                          value: option.key,
                                          label: option.label,
                                        }))}
                                      />
                                    </label>
                                    <label className="product-nc-panel__span">
                                      <span>Note (optional)</span>
                                      <input value={resolveNote} onChange={e => setResolveNote(e.target.value)} />
                                    </label>
                                  </div>
                                  <div className="product-nc-panel__resolve-actions">
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      disabled={saving}
                                      onClick={() => void handleResolve()}
                                    >
                                      {saving ? <RefreshCw size={14} className="spin-icon" /> : <CheckCircle2 size={14} />}
                                      Confirm resolve
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="product-nc-panel__history" aria-label="NC history">
            <div className="product-nc-panel__section-head">
              <h3>History</h3>
              <span className="product-nc-panel__section-count">{historyEvents.length}</span>
            </div>
            {historyEvents.length === 0 ? (
              <p className="text-muted text-sm">No history yet.</p>
            ) : (
              <ul>
                {historyEvents.map(event => (
                  <li key={event.id}>
                    <strong>{event.summary}</strong>
                    <span className="text-muted text-sm">
                      {new Date(event.at).toLocaleString('en-IN')}
                      {event.byName ? ` · ${event.byName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {lightboxUrl && (
        <div
          className="product-nc-panel__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="NC photo"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={event => {
            if (event.key === 'Escape') setLightboxUrl(null);
          }}
        >
          <button
            type="button"
            className="product-nc-panel__lightbox-close"
            aria-label="Close photo"
            onClick={() => setLightboxUrl(null)}
          >
            <X size={18} aria-hidden />
          </button>
          <img
            src={lightboxUrl}
            alt="NC photo"
            onClick={event => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
