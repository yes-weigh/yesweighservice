import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import type { BinNumber, RowNumber } from '../../types/yes-store';
import { formatLocationLabel } from '../../types/yes-store';
import {
  createItem,
  deleteItem,
  ensureBin,
  listItemsInBin,
  parseRouteLocation,
} from '../../lib/yesStore/data';
import { deleteYesStorePhotos, uploadYesStorePhoto } from '../../lib/yesStore/photos';
import { LocationBreadcrumb } from '../../components/yesStore/LocationBreadcrumb';
import { PhotoGallery } from '../../components/yesStore/PhotoGallery';
import { PendingPhotoPicker, type PendingPhoto } from '../../components/yesStore/PendingPhotoPicker';
import { useYesStorePhotos } from '../../lib/yesStore/useYesStorePhotos';
import type { YesStoreItemDoc, YesStorePhoto } from '../../types/yes-store';

const BASE = '/warehouse';

export const WarehouseBinPage: React.FC = () => {
  const { rackId = '', rowNum = '', binNum = '' } = useParams();
  const navigate = useNavigate();
  const location = parseRouteLocation(rackId, rowNum, binNum);
  const [binPhotos, setBinPhotos] = useState<YesStorePhoto[]>([]);
  const [items, setItems] = useState<YesStoreItemDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemNotes, setItemNotes] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const rowNumber = location?.rowNumber as RowNumber | undefined;
  const binNumber = location?.binNumber as BinNumber | undefined;
  const normalizedRackId = location?.rackId ?? '';
  const parentId =
    rowNumber != null && binNumber != null
      ? `${normalizedRackId}_${rowNumber}_${binNumber}`
      : '';

  const load = useCallback(async () => {
    if (!location?.rowNumber || !location.binNumber) return;
    setLoading(true);
    try {
      const bin = await ensureBin(location.rackId, location.rowNumber, location.binNumber);
      setBinPhotos(bin.photos ?? []);
      setItems(await listItemsInBin(location.rackId, location.rowNumber, location.binNumber));
    } finally {
      setLoading(false);
    }
  }, [location]);

  useEffect(() => {
    if (!location?.rowNumber || !location.binNumber) {
      navigate(BASE, { replace: true });
      return;
    }
    void load();
  }, [load, location, navigate]);

  const photoApi = useYesStorePhotos({
    level: 'bin',
    rackId: normalizedRackId,
    rowNumber,
    binNumber,
    parentId,
    photos: binPhotos,
    onPhotosChange: setBinPhotos,
  });

  const resetForm = () => {
    pendingPhotos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setPendingPhotos([]);
    setItemName('');
    setItemNotes('');
    setFormError('');
    setShowForm(false);
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location?.rowNumber || !location.binNumber) return;
    if (!itemName.trim()) {
      setFormError('Item name is required.');
      return;
    }
    if (!pendingPhotos.length) {
      setFormError('Attach at least one photo before saving.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const uploaded = [];
      for (const pending of pendingPhotos) {
        uploaded.push(
          await uploadYesStorePhoto(
            'item',
            `pending-${Date.now()}`,
            pending.file,
          ),
        );
      }
      const item = await createItem({
        rackId: location.rackId,
        rowNumber: location.rowNumber,
        binNumber: location.binNumber,
        name: itemName,
        notes: itemNotes,
        photos: uploaded,
      });
      resetForm();
      await load();
      navigate(`${BASE}/rack/${location.rackId}/row/${location.rowNumber}/bin/${location.binNumber}/item/${item.id}`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not save item');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (item: YesStoreItemDoc) => {
    if (deletingId) return;
    setDeletingId(item.id);
    try {
      await deleteItem(item.id);
      await deleteYesStorePhotos(item.photos ?? []);
      await load();
    } finally {
      setDeletingId(null);
    }
  };

  if (!location?.rowNumber || !location.binNumber) return null;

  return (
    <div className="yes-store-page fade-in">
      <LocationBreadcrumb
        basePath={BASE}
        rackId={location.rackId}
        rowNumber={location.rowNumber}
        binNumber={location.binNumber}
      />

      <header className="yes-store-page__header panel glass">
        <div>
          <h1>{formatLocationLabel(location.rackId, location.rowNumber, location.binNumber)}</h1>
          <p className="text-muted text-sm">{items.length} item{items.length === 1 ? '' : 's'}</p>
        </div>
        {!showForm && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            <Plus size={16} />
            Add item
          </button>
        )}
      </header>

      <PhotoGallery
        title="Bin photos"
        photos={binPhotos}
        uploading={photoApi.uploading}
        uploadProgress={photoApi.uploadProgress}
        onAddFiles={photoApi.onAddFiles}
        onDeletePhoto={photoApi.onDeletePhoto}
      />

      <section className="panel glass yes-store-items">
        <div className="yes-store-items__header">
          <h2>Items</h2>
        </div>

        {showForm && (
          <form className="yes-store-item-form" onSubmit={handleCreateItem}>
            {formError && <div className="login-error">{formError}</div>}
            <div className="form-group">
              <label htmlFor="item-name">Name</label>
              <input
                id="item-name"
                className="input-field"
                value={itemName}
                onChange={e => setItemName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="item-notes">Notes (optional)</label>
              <textarea
                id="item-notes"
                className="input-field"
                rows={2}
                value={itemNotes}
                onChange={e => setItemNotes(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Photos (required)</label>
              <PendingPhotoPicker
                photos={pendingPhotos}
                onChange={setPendingPhotos}
                disabled={saving}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save item'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="yes-store-page__loading"><div className="loader-ring" /></div>
        ) : items.length === 0 ? (
          <p className="text-muted">No items in this bin yet.</p>
        ) : (
          <ul className="yes-store-items__list">
            {items.map(item => {
              const missingPhotos = !item.photos?.length;
              const thumb = item.photos?.[0]?.url;
              return (
                <li
                  key={item.id}
                  className={`yes-store-items__row ${missingPhotos ? 'is-warning' : ''}`}
                >
                  <Link
                    to={`${BASE}/rack/${location.rackId}/row/${location.rowNumber}/bin/${location.binNumber}/item/${item.id}`}
                    className="yes-store-items__link"
                  >
                    <div className="yes-store-items__thumb">
                      {thumb ? <img src={thumb} alt="" /> : <span>{item.name.slice(0, 1)}</span>}
                    </div>
                    <div>
                      <strong>{item.name}</strong>
                      <p className="text-muted text-sm">
                        {item.photos?.length ?? 0} photo{(item.photos?.length ?? 0) === 1 ? '' : 's'}
                        {item.notes ? ` · ${item.notes}` : ''}
                      </p>
                      {missingPhotos && (
                        <span className="yes-store-items__warn">
                          <AlertTriangle size={14} aria-hidden />
                          Add photos
                        </span>
                      )}
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={deletingId === item.id}
                    onClick={() => void handleDeleteItem(item)}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
