import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VALID_RACK_LETTERS } from '../../types/yes-store';
import { getRack } from '../../lib/yesStore/data';
import { LocationCardGrid } from '../../components/yesStore/LocationCardGrid';

const BASE = '/warehouse';

export const WarehouseHomePage: React.FC = () => {
  const navigate = useNavigate();
  const [rackPhotos, setRackPhotos] = useState<Record<string, import('../../types/yes-store').YesStorePhoto[]>>({});
  const [loading, setLoading] = useState(true);

  const loadRacks = useCallback(async () => {
    setLoading(true);
    try {
      const map: Record<string, import('../../types/yes-store').YesStorePhoto[]> = {};
      await Promise.all(
        VALID_RACK_LETTERS.map(async rackId => {
          const rack = await getRack(rackId);
          map[rackId] = rack?.photos ?? [];
        }),
      );
      setRackPhotos(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRacks();
  }, [loadRacks]);

  const items = useMemo(
    () => VALID_RACK_LETTERS.map(rackId => ({
      id: rackId,
      label: rackId.toUpperCase(),
    })),
    [],
  );

  const photosById = rackPhotos;

  return (
    <div className="yes-store-page fade-in">
      <header className="yes-store-page__header panel glass">
        <div>
          <p className="yes-store-brand">YesStore</p>
          <h1>Warehouse racks</h1>
          <p className="text-muted text-sm">24 racks · tap a letter to open rows and bins</p>
        </div>
      </header>

      {loading ? (
        <div className="panel glass yes-store-page__loading">
          <div className="loader-ring" />
        </div>
      ) : (
        <LocationCardGrid
          items={items}
          photosById={photosById}
          onSelect={item => navigate(`${BASE}/rack/${item.id}`)}
        />
      )}
    </div>
  );
};
