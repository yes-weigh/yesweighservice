import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, LogOut, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  readItemQuantity,
  type BinNumber,
  type RowNumber,
  type YesStoreItemDoc,
} from '../../types/yes-store';
import { listAllItems } from '../../lib/yesStore/data';
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

const PAGE_SIZE = 25;

export const WarehouseHomePage: React.FC = () => {
  const { user, logout } = useAuth();
  const [items, setItems] = useState<YesStoreItemDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState<WizardStep>(null);
  const [draft, setDraft] = useState<DraftLocation>({});
  const [page, setPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageStart = items.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, items.length);

  const pageItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const resetWizard = () => {
    setWizard(null);
    setDraft({});
  };

  const goHome = () => {
    void loadItems();
    setPage(1);
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
              <span className="text-muted text-sm">
                {items.length} record{items.length === 1 ? '' : 's'}
                {items.length > 0 && ` · ${pageStart}–${pageEnd}`}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void loadItems()}
              >
                <RefreshCw size={14} className={loading ? 'spin-icon' : undefined} />
                Refresh
              </button>
            </div>

            <div className="wh-item-table-wrap">
              <table className="wh-item-table">
                <thead>
                  <tr>
                    <th>Img1</th>
                    <th>Img2</th>
                    <th>Qty</th>
                    <th>Rack</th>
                    <th>Row</th>
                    <th>Bin</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(item => {
                    const photos = item.photos ?? [];
                    return (
                      <tr
                        key={item.id}
                        className="wh-item-table__row"
                        onClick={() => openFromList(item)}
                      >
                        <td>
                          {photos[0] ? (
                            <img src={photos[0].url} alt="" loading="lazy" />
                          ) : (
                            <span className="wh-item-table__empty">—</span>
                          )}
                        </td>
                        <td>
                          {photos[1] ? (
                            <img src={photos[1].url} alt="" loading="lazy" />
                          ) : (
                            <span className="wh-item-table__empty">—</span>
                          )}
                        </td>
                        <td className="wh-item-table__num">{readItemQuantity(item)}</td>
                        <td className="wh-item-table__num">{item.rackId.toUpperCase()}</td>
                        <td className="wh-item-table__num">{item.rowNumber}</td>
                        <td className="wh-item-table__num">{item.binNumber}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <nav className="wh-pagination" aria-label="Item list pagination">
                <button
                  type="button"
                  className="wh-pagination__btn"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="wh-pagination__info">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="wh-pagination__btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight size={18} />
                </button>
              </nav>
            )}
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
