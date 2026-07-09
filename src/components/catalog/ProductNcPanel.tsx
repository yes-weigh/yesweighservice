import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  History,
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
} from '../../lib/catalogNc/data';
import { listWarehouseZoneRows, listWarehouseZones } from '../../lib/warehouseLocations/data';
import { CATALOG_INVENTORY_SITE_CONFIG } from '../../lib/catalogInventorySites';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import type { CatalogInventorySite } from '../../types/catalog-site-inventory';
import type {
  CatalogNcDoc,
  CatalogNcLine,
  CatalogNcLocation,
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
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../types/warehouse-locations';
import {
  BIN_NUMBERS,
  ROW_NUMBERS,
  VALID_RACK_LETTERS,
} from '../../types/yes-store';

export interface ProductNcPanelProps {
  product: CatalogProduct;
  categories: CatalogCategory[];
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
  actorUid: string;
  actorName?: string | null;
  /** Audited qty by location key for soft/hard validation hints. */
  auditedQtyByLocationKey?: Map<string, number>;
  onNcChange?: (doc: CatalogNcDoc | null) => void;
}

function locationKeyFromParts(site: CatalogInventorySite, parts: {
  zoneId?: string;
  zoneRowNumber?: number;
  rackId?: string;
  rowNumber?: number;
  binNumber?: number;
}): string {
  if (site === 'cochin') {
    return `cochin:${(parts.zoneId ?? '').toLowerCase()}:${parts.zoneRowNumber ?? 0}`;
  }
  return `head_office:${(parts.rackId ?? '').toLowerCase()}:${parts.rowNumber ?? 0}:${parts.binNumber ?? 0}`;
}

export const ProductNcPanel: React.FC<ProductNcPanelProps> = ({
  product,
  categories,
  open,
  onClose,
  canEdit,
  actorUid,
  actorName,
  auditedQtyByLocationKey,
  onNcChange,
}) => {
  const site = useMemo(
    () => resolveNcSiteForProduct(product, categories),
    [product, categories],
  );
  const siteConfig = CATALOG_INVENTORY_SITE_CONFIG[site];

  const [docData, setDocData] = useState<CatalogNcDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [zones, setZones] = useState<WarehouseZoneDoc[]>([]);
  const [zoneRows, setZoneRows] = useState<WarehouseZoneRowDoc[]>([]);
  const [zoneId, setZoneId] = useState('');
  const [zoneRowNumber, setZoneRowNumber] = useState('');
  const [rackId, setRackId] = useState('');
  const [rowNumber, setRowNumber] = useState('');
  const [binNumber, setBinNumber] = useState('');
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
  }, [open, load]);

  useEffect(() => {
    if (!open || site !== 'cochin') return;
    let active = true;
    void listWarehouseZones().then(list => {
      if (active) setZones(list);
    });
    return () => { active = false; };
  }, [open, site]);

  useEffect(() => {
    if (!zoneId) {
      setZoneRows([]);
      return;
    }
    let active = true;
    void listWarehouseZoneRows(zoneId).then(rows => {
      if (active) setZoneRows(rows);
    });
    return () => { active = false; };
  }, [zoneId]);

  const openLines = useMemo(() => {
    if (!docData) return [];
    return docData.locations.flatMap(location => (
      location.lines
        .filter(line => line.status === 'open')
        .map(line => ({ location, line }))
    ));
  }, [docData]);

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
    setSaving(true);
    setError(null);
    setWarnings([]);
    try {
      const location = site === 'cochin'
        ? { site, zoneId, zoneRowNumber: Number(zoneRowNumber) }
        : {
            site,
            rackId,
            rowNumber: Number(rowNumber),
            binNumber: Number(binNumber),
          };
      const key = locationKeyFromParts(site, {
        zoneId,
        zoneRowNumber: Number(zoneRowNumber),
        rackId,
        rowNumber: Number(rowNumber),
        binNumber: Number(binNumber),
      });
      const auditedQtyAtLocation = auditedQtyByLocationKey?.get(key) ?? null;
      const result = await addCatalogNcLine({
        catalogProductId: product.id,
        site,
        location,
        qty: Number(qty),
        reasonCode,
        reasonText,
        photos,
        actorUid,
        actorName,
        auditedQtyAtLocation,
        zohoStock: product.stock,
      });
      setDocData(result.doc);
      onNcChange?.(result.doc);
      setWarnings(result.warnings);
      setQty('1');
      setReasonText('');
      setPhotos([]);
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

  if (!open) return null;

  return (
    <div className="product-nc-panel panel glass">
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
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowHistory(v => !v)}
          >
            <History size={14} aria-hidden />
            History
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close NC">
            <X size={16} />
          </button>
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
          <div className="product-nc-panel__open-list">
            {openLines.length === 0 ? (
              <p className="text-muted text-sm">No open NC for this item.</p>
            ) : (
              openLines.map(({ location, line }) => (
                <div key={line.id} className="product-nc-panel__open-row">
                  <div className="product-nc-panel__open-main">
                    <strong>{line.qty} {product.unit}</strong>
                    <span>{ncReasonLabel(line.reasonCode, line.reasonText)}</span>
                    <span className="text-muted">{formatNcLocationLabel(location)}</span>
                    {line.photos.length > 0 && (
                      <div className="product-nc-panel__thumbs">
                        {line.photos.map(photo => (
                          <img key={photo.id} src={photo.url} alt="" />
                        ))}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setResolveTarget({ location, line });
                        setResolveQty(String(line.qty));
                        setResolveOutcome('repaired');
                      }}
                    >
                      <CheckCircle2 size={14} aria-hidden />
                      Resolve
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {canEdit && (
            <section className="product-nc-panel__add">
              <h3>Add NC</h3>
              <div className="product-nc-panel__form-grid">
                {site === 'cochin' ? (
                  <>
                    <label>
                      <span>Zone</span>
                      <select value={zoneId} onChange={e => { setZoneId(e.target.value); setZoneRowNumber(''); }}>
                        <option value="">Select</option>
                        {zones.map(zone => (
                          <option key={zone.id} value={zone.id}>{zone.id.toUpperCase()}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Row</span>
                      {zoneRows.length > 0 ? (
                        <select value={zoneRowNumber} onChange={e => setZoneRowNumber(e.target.value)} disabled={!zoneId}>
                          <option value="">Select</option>
                          {zoneRows.map(row => (
                            <option key={row.id} value={String(row.number)}>{row.number}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          min={1}
                          value={zoneRowNumber}
                          onChange={e => setZoneRowNumber(e.target.value)}
                          disabled={!zoneId}
                          placeholder="Row #"
                        />
                      )}
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      <span>Rack</span>
                      <select value={rackId} onChange={e => setRackId(e.target.value)}>
                        <option value="">Select</option>
                        {VALID_RACK_LETTERS.map(letter => (
                          <option key={letter} value={letter}>{letter.toUpperCase()}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Row</span>
                      <select value={rowNumber} onChange={e => setRowNumber(e.target.value)}>
                        <option value="">Select</option>
                        {ROW_NUMBERS.map(n => (
                          <option key={n} value={String(n)}>{n}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Bin</span>
                      <select value={binNumber} onChange={e => setBinNumber(e.target.value)}>
                        <option value="">Select</option>
                        {BIN_NUMBERS.map(n => (
                          <option key={n} value={String(n)}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label>
                  <span>Qty</span>
                  <input type="number" min={1} step={1} value={qty} onChange={e => setQty(e.target.value)} />
                </label>
                <label>
                  <span>Reason</span>
                  <select value={reasonCode} onChange={e => setReasonCode(e.target.value as NcReasonCode)}>
                    {NC_REASON_OPTIONS.map(option => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {reasonCode === 'other' && (
                  <label className="product-nc-panel__span">
                    <span>Other note</span>
                    <input value={reasonText} onChange={e => setReasonText(e.target.value)} placeholder="Describe the issue" />
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
                disabled={saving || uploadingPhoto}
                onClick={() => void handleAddLine()}
              >
                {saving ? <RefreshCw size={14} className="spin-icon" /> : <Plus size={14} />}
                Add NC line
              </button>
            </section>
          )}

          {resolveTarget && (
            <section className="product-nc-panel__resolve">
              <h3>Resolve NC</h3>
              <p className="text-sm text-muted">
                {resolveTarget.line.qty} open · {formatNcLocationLabel(resolveTarget.location)}
              </p>
              <div className="product-nc-panel__form-grid">
                <label>
                  <span>Qty to resolve</span>
                  <input
                    type="number"
                    min={1}
                    max={resolveTarget.line.qty}
                    value={resolveQty}
                    onChange={e => setResolveQty(e.target.value)}
                  />
                </label>
                <label>
                  <span>Outcome</span>
                  <select
                    value={resolveOutcome}
                    onChange={e => setResolveOutcome(e.target.value as NcResolveOutcome)}
                  >
                    {NC_RESOLVE_OUTCOMES.map(option => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="product-nc-panel__span">
                  <span>Note (optional)</span>
                  <input value={resolveNote} onChange={e => setResolveNote(e.target.value)} />
                </label>
              </div>
              <div className="product-nc-panel__resolve-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleResolve()}>
                  Confirm resolve
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setResolveTarget(null)}>Cancel</button>
              </div>
            </section>
          )}

          {showHistory && (
            <section className="product-nc-panel__history">
              <h3>History</h3>
              {(docData?.events ?? []).length === 0 ? (
                <p className="text-muted text-sm">No history yet.</p>
              ) : (
                <ul>
                  {(docData?.events ?? []).map(event => (
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
          )}
        </>
      )}
    </div>
  );
};
