import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  readItemQuantity,
  type BinNumber,
  type RowNumber,
  type YesStoreItemDoc,
} from '../../types/yes-store';
import { listAllItems } from '../../lib/yesStore/data';
import { formatRelativeTime } from '../../lib/yesStore/format';
import { WarehouseRackPicker } from '../../components/yesStore/WarehouseRackPicker';
import { WarehouseRowPicker } from '../../components/yesStore/WarehouseRowPicker';
import { WarehouseBinPicker } from '../../components/yesStore/WarehouseBinPicker';
import { WarehouseBinEditor } from '../../components/yesStore/WarehouseBinEditor';

type WizardStep = null | 'rack' | 'row' | 'bin' | 'editor';

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
    setWizard(null);
    setDraft({});
  };

  const goHome = () => {
    void loadItems();
    resetWizard();
  };

  const startAdd = () => {
    resetWizard();
    setWizard('rack');
  };

  const openBin = (rackId: string, rowNumber: RowNumber, binNumber: BinNumber) => {
    setDraft({ rackId, rowNumber, binNumber });
    setWizard('editor');
  };

  const openFromList = (item: YesStoreItemDoc) => {
    openBin(item.rackId, item.rowNumber, item.binNumber);
  };

  if (wizard === 'rack') {
    return (
      <WarehouseRackPicker
        onBack={resetWizard}
        onHome={goHome}
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
        onHome={goHome}
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
        onHome={goHome}
        onNext={binNumber => {
          setDraft(prev => ({ ...prev, binNumber }));
          setWizard('editor');
        }}
      />
    );
  }

  if (wizard === 'editor' && draft.rackId && draft.rowNumber != null && draft.binNumber != null) {
    return (
      <WarehouseBinEditor
        rackId={draft.rackId}
        rowNumber={draft.rowNumber}
        binNumber={draft.binNumber}
        onBack={() => setWizard('bin')}
        onHome={goHome}
        onSaved={() => void loadItems()}
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
            No audits yet. Tap + to pick a rack, row, and bin.
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
                  <button type="button" className="warehouse-item-card" onClick={() => openFromList(item)}>
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
