import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  addCatalogNcLine,
  deleteCatalogNcPhoto,
  resolveNcSiteForProduct,
  uploadCatalogNcPhoto,
} from '../../lib/catalogNc/data';
import { CATALOG_INVENTORY_SITE_CONFIG } from '../../lib/catalogInventorySites';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import type {
  CatalogNcDoc,
  CatalogNcLocationKey,
  CatalogNcPhoto,
  NcReasonCode,
} from '../../types/catalog-nc';
import {
  formatNcLocationLabel,
  MAX_NC_PHOTOS_PER_LINE,
  NC_REASON_OPTIONS,
  ncLocationKey,
  ncReasonLabel,
} from '../../types/catalog-nc';
import { ProductNcSelect } from './ProductNcSelect';
import { ProductNcLocationPicker } from './ProductNcLocationPicker';
import type { ProductNcExistingLocation } from './ProductNcPanel';

export const ProductOpenNcTile: React.FC<{
  product: CatalogProduct;
  categories: CatalogCategory[];
  ncDoc: CatalogNcDoc | null;
  existingLocations: ProductNcExistingLocation[];
  canAdd: boolean;
  actorUid: string;
  actorName?: string | null;
  onNcChange: (doc: CatalogNcDoc | null) => void;
  onOpenNcTab: (lineId?: string) => void;
}> = ({
  product,
  categories,
  ncDoc,
  existingLocations,
  canAdd,
  actorUid,
  actorName,
  onNcChange,
  onOpenNcTab,
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

  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draftLocation, setDraftLocation] = useState<CatalogNcLocationKey | null>(null);
  const [qty, setQty] = useState('1');
  const [reasonCode, setReasonCode] = useState<NcReasonCode>('display_issue');
  const [reasonText, setReasonText] = useState('');
  const [photos, setPhotos] = useState<CatalogNcPhoto[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

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
    if (!ncDoc) return [];
    return ncDoc.locations.flatMap(location => (
      location.lines
        .filter(line => line.status === 'open')
        .map(line => ({ location, line }))
    ));
  }, [ncDoc]);

  const openQty = ncDoc?.openNcQty ?? 0;
  const isClear = openLines.length === 0 && openQty === 0;

  const openAddForm = () => {
    setShowAddForm(true);
    setDraftLocation(null);
    setError(null);
    setWarnings([]);
  };

  const closeAddForm = () => {
    setShowAddForm(false);
    setDraftLocation(null);
    setWarnings([]);
    setError(null);
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
    if (!canAdd || saving) return;
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
      onNcChange(result.doc);
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

  return (
    <section
      className={`product-open-nc-tile${isClear ? ' product-open-nc-tile--clear' : ''}`}
      aria-label="Open non-conformance"
    >
      <div className="product-open-nc-tile__head">
        <div className="product-open-nc-tile__title-row">
          <AlertTriangle size={16} aria-hidden />
          <h2 className="product-open-nc-tile__title">Open NC</h2>
          <span className="product-open-nc-tile__count">{openQty}</span>
        </div>
        {canAdd && (
          <button
            type="button"
            className="btn btn-sm product-open-nc-tile__add"
            onClick={() => (showAddForm ? closeAddForm() : openAddForm())}
            aria-expanded={showAddForm}
          >
            {showAddForm ? <X size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
            {showAddForm ? 'Close' : 'Add NC'}
          </button>
        )}
      </div>

      {error && <p className="product-nc-panel__error text-sm">{error}</p>}
      {warnings.map(warning => (
        <p key={warning} className="product-nc-panel__warning text-sm">
          <AlertTriangle size={14} aria-hidden />
          {warning}
        </p>
      ))}

      {canAdd && showAddForm && (
        <section className="product-open-nc-tile__add-form" aria-label="Add NC">
          <div className="product-open-nc-tile__form-grid">
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
              <label className="product-open-nc-tile__span">
                <span>Other note</span>
                <input
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  placeholder="Describe the issue"
                />
              </label>
            )}
            {auditedQtyForDraft != null && (
              <p className="text-muted text-sm product-open-nc-tile__span">
                Audited at this location: {auditedQtyForDraft} {product.unit}
              </p>
            )}
          </div>

          <div className="product-open-nc-tile__actions">
            <div className="product-open-nc-tile__photos">
              {photos.map(photo => (
                <div key={photo.id} className="product-nc-panel__photo">
                  <img src={photo.url} alt="" />
                  <button type="button" onClick={() => void removePhoto(photo)} aria-label="Remove photo">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {photos.length < MAX_NC_PHOTOS_PER_LINE && (
                <label className="product-open-nc-tile__photo-add" title="Add photo">
                  {uploadingPhoto ? <RefreshCw size={14} className="spin-icon" /> : <Camera size={14} />}
                  <input type="file" accept="image/*" hidden onChange={e => void handlePhotoPick(e)} />
                </label>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm product-open-nc-tile__submit"
              disabled={saving || uploadingPhoto || !draftLocation}
              onClick={() => void handleAddLine()}
            >
              {saving ? <RefreshCw size={14} className="spin-icon" /> : <Plus size={14} />}
              Add NC
            </button>
          </div>
        </section>
      )}

      {isClear && !showAddForm ? (
        <p className="product-open-nc-tile__empty text-muted text-sm">
          No open NC at {siteConfig.warehouseName}.
        </p>
      ) : openLines.length > 0 ? (
        <div className="product-site-stock__table-wrap product-site-stock__table-wrap--warehouse product-open-nc-tile__table-wrap">
          <table className="product-site-stock__table product-site-stock__table--hero-values product-open-nc-tile__table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Qty</th>
                <th>Reason</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {openLines.map(({ location, line }) => (
                <tr
                  key={line.id}
                  className="product-open-nc-tile__row"
                  onClick={() => onOpenNcTab(line.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenNcTab(line.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open NC details for ${ncReasonLabel(line.reasonCode, line.reasonText)}`}
                >
                  <td className="product-open-nc-tile__photo-cell">
                    {line.photos[0] ? (
                      <img src={line.photos[0].url} alt="" />
                    ) : (
                      <span className="product-open-nc-tile__photo-empty">—</span>
                    )}
                  </td>
                  <td className="product-site-stock__qty-cell">
                    <span className="product-site-stock__qty-main">{line.qty}</span>
                  </td>
                  <td>{ncReasonLabel(line.reasonCode, line.reasonText)}</td>
                  <td>{formatNcLocationLabel(location)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
};
