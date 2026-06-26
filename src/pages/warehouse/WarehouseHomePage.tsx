import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  readItemQuantity,
  type BinNumber,
  type RowNumber,
  type YesStoreItemDoc,
  type YesStorePhoto,
} from '../../types/yes-store';
import {
  createItem,
  listAllItems,
  updateItem,
} from '../../lib/yesStore/data';
import { deleteYesStorePhotos, uploadYesStorePhoto } from '../../lib/yesStore/photos';
import { formatRelativeTime } from '../../lib/yesStore/format';
import { WarehouseRackPicker } from '../../components/yesStore/WarehouseRackPicker';
import { WarehouseRowPicker } from '../../components/yesStore/WarehouseRowPicker';
import { WarehouseBinPicker } from '../../components/yesStore/WarehouseBinPicker';
import { WarehouseCapturePhotos } from '../../components/yesStore/WarehouseCapturePhotos';
import { WarehouseEnterQuantity } from '../../components/yesStore/WarehouseEnterQuantity';
import { pendingFromFile, type PhotoSlot } from '../../components/yesStore/ItemPhotoQtyForm';

type WizardStep = null | 'rack' | 'row' | 'bin' | 'photos' | 'quantity';

type DraftLocation = {
  rackId?: string;
  rowNumber?: RowNumber;
  binNumber?: BinNumber;
};

export const WarehouseHomePage: React.FC = () => {
  const { user, logout } = useAuth();
  const [items, setItems] = useState<YesStoreItemDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState<WizardStep>(null);
  const [draft, setDraft] = useState<DraftLocation>({});
  const [editingItem, setEditingItem] = useState<YesStoreItemDoc | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [photoSlots, setPhotoSlots] = useState<PhotoSlot[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listAllItems());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const resetWizard = () => {
    photoSlots.forEach(slot => {
      if (slot.kind === 'pending') URL.revokeObjectURL(slot.pending.previewUrl);
    });
    setWizard(null);
    setDraft({});
    setEditingItem(null);
    setQuantity(1);
    setPhotoSlots([]);
    setFormError('');
    setSaveSuccess(false);
  };

  const startAdd = () => {
    resetWizard();
    setWizard('rack');
  };

  const openEdit = (item: YesStoreItemDoc) => {
    photoSlots.forEach(slot => {
      if (slot.kind === 'pending') URL.revokeObjectURL(slot.pending.previewUrl);
    });
    setEditingItem(item);
    setDraft({
      rackId: item.rackId,
      rowNumber: item.rowNumber,
      binNumber: item.binNumber,
    });
    setQuantity(readItemQuantity(item));
    setPhotoSlots((item.photos ?? []).map(photo => ({ kind: 'saved' as const, photo })));
    setFormError('');
    setSaveSuccess(false);
    setWizard('photos');
  };

  const uploadSlots = async (slots: PhotoSlot[]): Promise<YesStorePhoto[]> => {
    const uploaded: YesStorePhoto[] = [];
    for (const slot of slots) {
      if (slot.kind === 'saved') {
        uploaded.push(slot.photo);
        continue;
      }
      const parentId = editingItem?.id ?? `new_${draft.rackId}_${draft.rowNumber}_${draft.binNumber}`;
      const photo = await uploadYesStorePhoto('item', parentId, slot.pending.file);
      uploaded.push(photo);
    }
    return uploaded;
  };

  const handleSubmit = async () => {
    if (!draft.rackId || draft.rowNumber == null || draft.binNumber == null) return;
    if (!photoSlots.length) {
      setFormError('Add at least one photo.');
      return;
    }
    setSaving(true);
    setFormError('');
    setSaveSuccess(false);
    try {
      const photos = await uploadSlots(photoSlots);
      if (editingItem) {
        const removed = editingItem.photos.filter(
          prev => !photos.some(next => next.id === prev.id),
        );
        await updateItem(editingItem.id, { quantity, photos });
        if (removed.length) await deleteYesStorePhotos(removed);
      } else {
        await createItem({
          rackId: draft.rackId,
          rowNumber: draft.rowNumber,
          binNumber: draft.binNumber,
          quantity,
          photos,
        });
      }
      setSaveSuccess(true);
      await loadItems();
      window.setTimeout(() => resetWizard(), 1400);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not save item');
    } finally {
      setSaving(false);
    }
  };

  const handleAddPhoto = (file: File) => {
    if (photoSlots.length >= 2) return;
    setPhotoSlots(prev => [...prev, { kind: 'pending', pending: pendingFromFile(file) }]);
  };

  const handleRemoveSlot = (index: number) => {
    setPhotoSlots(prev => {
      const slot = prev[index];
      if (slot?.kind === 'pending') URL.revokeObjectURL(slot.pending.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  if (wizard === 'rack') {
    return (
      <WarehouseRackPicker
        onBack={resetWizard}
        onNext={rackId => {
          setDraft({ rackId });
          setWizard('row');
        }}
      />
    );
  }

  if (wizard === 'row' && draft.rackId) {
    return (
      <WarehouseRowPicker
        rackId={draft.rackId}
        onBack={() => setWizard('rack')}
        onNext={rowNumber => {
          setDraft(prev => ({ ...prev, rowNumber }));
          setWizard('bin');
        }}
      />
    );
  }

  if (wizard === 'bin' && draft.rackId && draft.rowNumber != null) {
    return (
      <WarehouseBinPicker
        rackId={draft.rackId}
        rowNumber={draft.rowNumber}
        onBack={() => setWizard('row')}
        onNext={binNumber => {
          setDraft(prev => ({ ...prev, binNumber }));
          setWizard('photos');
        }}
      />
    );
  }

  if (wizard === 'photos' && draft.rackId && draft.rowNumber != null && draft.binNumber != null) {
    return (
      <WarehouseCapturePhotos
        rackId={draft.rackId}
        rowNumber={draft.rowNumber}
        binNumber={draft.binNumber}
        slots={photoSlots}
        onAddPhoto={handleAddPhoto}
        onRemoveSlot={handleRemoveSlot}
        onBack={() => {
          if (editingItem) resetWizard();
          else setWizard('bin');
        }}
        onNext={() => setWizard('quantity')}
      />
    );
  }

  if (wizard === 'quantity' && draft.rackId && draft.rowNumber != null && draft.binNumber != null) {
    return (
      <WarehouseEnterQuantity
        rackId={draft.rackId}
        rowNumber={draft.rowNumber}
        binNumber={draft.binNumber}
        quantity={quantity}
        onQuantityChange={setQuantity}
        photoCount={photoSlots.length}
        onBack={() => setWizard('photos')}
        onSubmit={() => void handleSubmit()}
        saving={saving}
        error={formError}
        success={saveSuccess}
      />
    );
  }

  return (
    <div className="warehouse-app">
      <header className="warehouse-app__bar">
        <h1 className="warehouse-app__title">Inventory Auditor</h1>
        <button type="button" className="warehouse-app__fab" onClick={startAdd} aria-label="Add item">
          <Plus size={22} />
        </button>
      </header>

      <main className="warehouse-app__main">
        {user?.loginId && (
          <p className="warehouse-app__signed-in text-muted text-sm">Signed in as {user.loginId}</p>
        )}

        {loading && items.length === 0 ? (
          <div className="warehouse-app__loading">
            <div className="loader-ring" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted warehouse-app__empty">
            No audits yet. Tap + to record rack location, photos, and quantity.
          </p>
        ) : (
          <>
            <div className="warehouse-app__list-toolbar">
              <span className="text-muted text-sm">{items.length} record{items.length === 1 ? '' : 's'}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void loadItems()}
              >
                <RefreshCw size={14} className={loading ? 'spin-icon' : undefined} />
                Refresh
              </button>
            </div>
            <ul className="warehouse-item-list">
              {items.map(item => (
                <li key={item.id}>
                  <button type="button" className="warehouse-item-card" onClick={() => openEdit(item)}>
                    <div className="warehouse-item-card__photos">
                      {(item.photos ?? []).slice(0, 2).map(photo => (
                        <img key={photo.id} src={photo.url} alt="" loading="lazy" />
                      ))}
                      {!item.photos?.length && <span className="warehouse-item-card__no-photo">—</span>}
                    </div>
                    <div className="warehouse-item-card__body">
                      <strong>
                        {item.rackId.toUpperCase()} · {item.rowNumber} · {item.binNumber}
                      </strong>
                      <span className="text-muted text-sm">Qty {readItemQuantity(item)}</span>
                      <span className="warehouse-item-card__time text-muted text-sm">
                        {formatRelativeTime(item.updatedAt)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      <footer className="warehouse-app__footer">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void logout()}>
          <LogOut size={16} />
          Sign out
        </button>
      </footer>
    </div>
  );
};
