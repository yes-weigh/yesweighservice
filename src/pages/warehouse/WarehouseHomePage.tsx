import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { BinNumber, RowNumber, YesStoreItemDoc } from '../../types/yes-store';
import { listAllItems } from '../../lib/yesStore/data';
import { WarehouseRackPicker } from '../../components/yesStore/WarehouseRackPicker';
import { WarehouseRowPicker } from '../../components/yesStore/WarehouseRowPicker';
import { WarehouseBinPicker } from '../../components/yesStore/WarehouseBinPicker';
import { WarehouseBinEditor } from '../../components/yesStore/WarehouseBinEditor';
import { WarehouseItemEditor } from '../../components/yesStore/WarehouseItemEditor';
import { WarehouseInventoryAuditList } from '../../components/yesStore/WarehouseInventoryAuditList';

type WizardStep = null | 'rack' | 'row' | 'bin' | 'editor' | 'item-edit';

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
  const [editItem, setEditItem] = useState<YesStoreItemDoc | null>(null);
  const [ensureDraftRow, setEnsureDraftRow] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listAllItems(null));
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
    setEditItem(null);
    setEnsureDraftRow(false);
  };

  const goHome = () => {
    void loadItems();
    resetWizard();
  };

  const startAdd = () => {
    resetWizard();
    setWizard('rack');
  };

  const openFromList = (item: YesStoreItemDoc) => {
    setEditItem(item);
    setWizard('item-edit');
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
        ensureDraftRow={ensureDraftRow}
        onBack={() => setWizard('bin')}
        onHome={goHome}
        onSaved={() => void loadItems()}
      />
    );
  }

  if (wizard === 'item-edit' && editItem) {
    return (
      <WarehouseItemEditor
        item={editItem}
        onBack={goHome}
        onHome={goHome}
        onSaved={() => void loadItems()}
        onReplacedInBin={location => {
          setEditItem(null);
          setEnsureDraftRow(true);
          setDraft({
            rackId: location.rackId,
            rowNumber: location.rowNumber,
            binNumber: location.binNumber,
          });
          setWizard('editor');
          void loadItems();
        }}
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

        <WarehouseInventoryAuditList
          items={items}
          loading={loading}
          onRefresh={() => void loadItems()}
          onItemClick={openFromList}
          emptyMessage="No audits yet. Tap + to pick a rack, row, and bin."
        />
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
