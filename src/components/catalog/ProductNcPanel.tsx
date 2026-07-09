import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
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
  formatNcLocationLabel,
  MAX_NC_PHOTOS_PER_LINE,
  NC_REASON_OPTIONS,
  NC_RESOLVE_OUTCOMES,
  ncReasonLabel,
} from '../../types/catalog-nc';
import { ProductNcSelect } from './ProductNcSelect';

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
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);

  const [selectedLocationKey, setSelectedLocationKey] = useState('');
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
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    setExpandedLineId(focusLineId ?? null);
  }, [open, focusLineId]);

  useEffect(() => {
    if (siteLocations.length === 0) {
      setSelectedLocationKey('');
      return;
    }
    if (!siteLocations.some(loc => loc.key === selectedLocationKey)) {
      setSelectedLocationKey(siteLocations[0]?.key ?? '');
    }
  }, [siteLocations, selectedLocationKey]);

  const selectedLocation = useMemo(
    () => siteLocations.find(loc => loc.key === selectedLocationKey) ?? null,
    [siteLocations, selectedLocationKey],
  );

  const openLines = useMemo(() => {
    if (!docData) return [];
    return docData.locations.flatMap(location => (
      location.lines
        .filter(line => line.status === 'open')
        .map(line => ({ location, line }))
    ));
  }, [docData]);

  const historyEvents = useMemo(
    () => [...(docData?.events ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    [docData],
  );

  const toggleExpand = (lineId: string) => {
    setExpandedLineId(prev => (prev === lineId ? null : lineId));
    if (resolveTarget?.line.id !== lineId) {
      setResolveTarget(null);
      setResolveNote('');
    }
  };

  const startResolve = (location: CatalogNcLocation, line: CatalogNcLine) => {
    setExpandedLineId(line.id);
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
    setError(null);
    setWarnings([]);
  };

  const closeAddForm = () => {
    setShowAddForm(false);
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
    if (!selectedLocation) {
      setError('Select an existing storage location for this item.');
      return;
    }
    setSaving(true);
    setError(null);
    setWarnings([]);
    try {
      const result = await addCatalogNcLine({
        catalogProductId: product.id,
        site,
        location: selectedLocation.location,
        qty: Number(qty),
        reasonCode,
        reasonText,
        photos,
        actorUid,
        actorName,
        auditedQtyAtLocation: selectedLocation.auditedQty,
        zohoStock: product.stock,
      });
      setDocData(result.doc);
      onNcChange?.(result.doc);
      setWarnings(result.warnings);
      setQty('1');
      setReasonText('');
      setPhotos([]);
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
      setExpandedLineId(null);
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
      setExpandedLineId(null);
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
            {siteConfig.warehouseName} · {siteConfig.locationSubtitle}
            {' · '}
            Open NC: <strong>{docData?.openNcQty ?? 0}</strong>
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
              {siteLocations.length === 0 ? (
                <p className="text-muted text-sm">
                  No existing {siteConfig.locationSubtitle.toLowerCase()} locations for this item yet.
                  Add audited stock locations first, then mark NC against them.
                </p>
              ) : (
                <>
                  <div className="product-nc-panel__form-grid">
                    <label className="product-nc-panel__span">
                      <span>Location</span>
                      <ProductNcSelect
                        aria-label="Location"
                        value={selectedLocationKey}
                        onChange={setSelectedLocationKey}
                        options={siteLocations.map(loc => ({
                          value: loc.key,
                          label: `${loc.label} · audited ${loc.auditedQty} ${product.unit}`,
                        }))}
                      />
                    </label>
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
                    disabled={saving || uploadingPhoto || !selectedLocation}
                    onClick={() => void handleAddLine()}
                  >
                    {saving ? <RefreshCw size={14} className="spin-icon" /> : <Plus size={14} />}
                    Add NC line
                  </button>
                </>
              )}
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
              <div className="product-nc-panel__open-list">
                {openLines.map(({ location, line }) => {
                  const isExpanded = expandedLineId === line.id;
                  const isResolving = resolveTarget?.line.id === line.id;
                  return (
                    <div
                      key={line.id}
                      className={`product-nc-panel__tile${isExpanded ? ' is-expanded' : ''}`}
                    >
                      <div className="product-nc-panel__tile-top">
                        <button
                          type="button"
                          className="product-nc-panel__tile-toggle"
                          onClick={() => toggleExpand(line.id)}
                          aria-expanded={isExpanded}
                        >
                          <span className="product-nc-panel__tile-main">
                            <strong>
                              {line.qty} {product.unit}
                            </strong>
                            <span>{ncReasonLabel(line.reasonCode, line.reasonText)}</span>
                            <span className="text-muted">{formatNcLocationLabel(location)}</span>
                          </span>
                          <ChevronDown
                            size={16}
                            className={`product-nc-panel__chevron${isExpanded ? ' is-open' : ''}`}
                            aria-hidden
                          />
                        </button>
                        {canEdit && !isResolving && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => startResolve(location, line)}
                          >
                            <CheckCircle2 size={14} aria-hidden />
                            Resolve
                          </button>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="product-nc-panel__tile-body">
                          {line.photos.length > 0 && (
                            <div className="product-nc-panel__thumbs">
                              {line.photos.map(photo => (
                                <img key={photo.id} src={photo.url} alt="" />
                              ))}
                            </div>
                          )}

                          {line.createdAt && (
                            <p className="product-nc-panel__tile-meta text-muted text-sm">
                              Opened {new Date(line.createdAt).toLocaleString('en-IN')}
                              {line.createdByName ? ` · ${line.createdByName}` : ''}
                            </p>
                          )}

                          {canEdit && isResolving && (
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
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={saving}
                                  onClick={cancelResolve}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
    </div>
  );
};
