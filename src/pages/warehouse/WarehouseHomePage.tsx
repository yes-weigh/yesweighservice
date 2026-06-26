import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VALID_RACK_LETTERS } from '../../types/yes-store';
import type { YesStoreItemDoc, YesStorePhoto } from '../../types/yes-store';
import { getRack, listRecentItems } from '../../lib/yesStore/data';
import { LocationCardGrid } from '../../components/yesStore/LocationCardGrid';
import { RecentItemsList } from '../../components/yesStore/RecentItemsList';

const BASE = '/warehouse';

export const WarehouseHomePage: React.FC = () => {
  const navigate = useNavigate();
  const [rackPhotos, setRackPhotos] = useState<Record<string, YesStorePhoto[]>>({});
  const [recentItems, setRecentItems] = useState<YesStoreItemDoc[]>([]);
  const [loadingRacks, setLoadingRacks] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const loadRacks = useCallback(async () => {
    setLoadingRacks(true);
    try {
      const map: Record<string, YesStorePhoto[]> = {};
      await Promise.all(
        VALID_RACK_LETTERS.map(async rackId => {
          const rack = await getRack(rackId);
          map[rackId] = rack?.photos ?? [];
        }),
      );
      setRackPhotos(map);
    } finally {
      setLoadingRacks(false);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      setRecentItems(await listRecentItems(24));
    } catch {
      setRecentItems([]);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    void loadRacks();
    void loadRecent();
  }, [loadRacks, loadRecent]);

  const items = useMemo(
    () => VALID_RACK_LETTERS.map(rackId => ({
      id: rackId,
      label: rackId.toUpperCase(),
    })),
    [],
  );

  return (
    <div className="yes-store-page fade-in">
      <header className="yes-store-page__header panel glass">
        <div>
          <p className="yes-store-brand">YesStore</p>
          <h1>Warehouse racks</h1>
          <p className="text-muted text-sm">24 racks · tap a letter to open rows and bins</p>
        </div>
      </header>

      <RecentItemsList
        basePath={BASE}
        items={recentItems}
        loading={loadingRecent}
      />

      <section className="panel glass">
        <h2 className="yes-store-section-title">All racks</h2>
        {loadingRacks && (
          <p className="text-muted text-sm yes-store-grid__status">Loading rack photos…</p>
        )}
        <LocationCardGrid
          items={items}
          photosById={rackPhotos}
          onSelect={item => navigate(`${BASE}/rack/${item.id}`)}
        />
      </section>
    </div>
  );
};
