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
  CatalogNcPhoto,
  NcReasonCode,
} from '../../types/catalog-nc';
import {
  formatNcLocationLabel,
  MAX_NC_PHOTOS_PER_LINE,
  NC_REASON_OPTIONS,
  ncReasonLabel,
} from '../../types/catalog-nc';
import { ProductNcSelect } from './ProductNcSelect';
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
  const [selectedLocationKey, setSelectedLocationKey] = useState('');
  const [qty, setQty] = useState('1');
  const [reasonCode, setReasonCode] = useState<NcReasonCode>('display_issue');
  const [reasonText, setReasonText] = useState('');
  const [photos, setPhotos] = useState<CatalogNcPhoto[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

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
    setError(null);
    setWarnings([]);
  };

  const closeAddForm = () => {
    setShowAddForm(false);
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
      onNcChange(result.doc);
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
          {siteLocations.length === 0 ? (
            <p className="text-muted text-sm">
              No existing {siteConfig.locationSubtitle.toLowerCase()} locations for this item yet.
              Add audited stock locations first, then mark NC against them.
            </p>
          ) : (
            <>
              <div className="product-open-nc-tile__form-grid">
                <label className="product-open-nc-tile__span">
                  <span>Location</span>
                  <ProductNcSelect
                    aria-label="Location"
                    value={selectedLocationKey}
                    onChange={setSelectedLocationKey}
                    options={siteLocations.map(loc => ({
                      value: loc.key,
                      label: loc.label,
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
                  <label className="product-open-nc-tile__span">
                    <span>Other note</span>
                    <input
                      value={reasonText}
                      onChange={e => setReasonText(e.target.value)}
                      placeholder="Describe the issue"
                    />
                  </label>
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
                  disabled={saving || uploadingPhoto || !selectedLocation}
                  onClick={() => void handleAddLine()}
                >
                  {saving ? <RefreshCw size={14} className="spin-icon" /> : <Plus size={14} />}
                  Add NC
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {!showAddForm && openLines.length === 0 ? (
        <p className="product-open-nc-tile__empty text-muted text-sm">No open NC for this item.</p>
      ) : !showAddForm ? (
        <div className="product-site-stock__table-wrap product-site-stock__table-wrap--warehouse product-open-nc-tile__table-wrap">
          <table className="product-site-stock__table product-open-nc-tile__table">
            <thead>
              <tr>
                <th className="product-open-nc-tile__th-photo" scope="col" aria-label="Photo" />
                <th scope="col">Qty</th>
                <th scope="col">Reason</th>
                <th scope="col">Location</th>
              </tr>
            </thead>
            <tbody>
              {openLines.map(({ location, line }) => {
                const thumb = line.photos[0]?.url ?? null;
                return (
                  <tr
                    key={line.id}
                    className="product-open-nc-tile__tr"
                    onClick={() => onOpenNcTab(line.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenNcTab(line.id);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    title="Open NC details"
                  >
                    <td className="product-open-nc-tile__td-photo">
                      {thumb ? (
                        <img src={thumb} alt="" className="product-open-nc-tile__thumb" />
                      ) : (
                        <span className="product-open-nc-tile__thumb product-open-nc-tile__thumb--empty" aria-hidden>
                          <Camera size={12} />
                        </span>
                      )}
                    </td>
                    <td className="product-open-nc-tile__td-qty">
                      {line.qty} {product.unit}
                    </td>
                    <td>{ncReasonLabel(line.reasonCode, line.reasonText)}</td>
                    <td>{formatNcLocationLabel(location)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
};
