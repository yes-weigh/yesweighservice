import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ROW_NUMBERS } from '../../types/yes-store';
import { ensureRack, getRow, parseRouteLocation } from '../../lib/yesStore/data';
import { LocationBreadcrumb } from '../../components/yesStore/LocationBreadcrumb';
import { LocationCardGrid } from '../../components/yesStore/LocationCardGrid';
import { PhotoGallery } from '../../components/yesStore/PhotoGallery';
import { useYesStorePhotos } from '../../lib/yesStore/useYesStorePhotos';
import type { YesStorePhoto } from '../../types/yes-store';

const BASE = '/warehouse';

export const WarehouseRackPage: React.FC = () => {
  const { rackId = '' } = useParams();
  const navigate = useNavigate();
  const location = parseRouteLocation(rackId);
  const [rackPhotos, setRackPhotos] = useState<YesStorePhoto[]>([]);
  const [rowPhotos, setRowPhotos] = useState<Record<string, YesStorePhoto[]>>({});
  const [loading, setLoading] = useState(true);

  const normalizedRackId = location?.rackId ?? '';

  const load = useCallback(async () => {
    if (!location) return;
    setLoading(true);
    try {
      const rack = await ensureRack(location.rackId);
      setRackPhotos(rack.photos ?? []);
      const rows: Record<string, YesStorePhoto[]> = {};
      await Promise.all(
        ROW_NUMBERS.map(async rowNumber => {
          const row = await getRow(location.rackId, rowNumber);
          rows[String(rowNumber)] = row?.photos ?? [];
        }),
      );
      setRowPhotos(rows);
    } finally {
      setLoading(false);
    }
  }, [location]);

  useEffect(() => {
    if (!location) {
      navigate(BASE, { replace: true });
      return;
    }
    void load();
  }, [load, location, navigate]);

  const photoApi = useYesStorePhotos({
    level: 'rack',
    rackId: normalizedRackId,
    parentId: normalizedRackId,
    photos: rackPhotos,
    onPhotosChange: setRackPhotos,
  });

  const items = useMemo(
    () => ROW_NUMBERS.map(n => ({ id: String(n), label: String(n) })),
    [],
  );

  if (!location) return null;

  return (
    <div className="yes-store-page fade-in">
      <LocationBreadcrumb basePath={BASE} rackId={location.rackId} />

      <header className="yes-store-page__header panel glass">
        <div>
          <h1>Rack {location.rackId.toUpperCase()}</h1>
          <p className="text-muted text-sm">Rows 1–7</p>
        </div>
      </header>

      <PhotoGallery
        title="Rack photos"
        photos={rackPhotos}
        uploading={photoApi.uploading}
        uploadProgress={photoApi.uploadProgress}
        onAddFiles={photoApi.onAddFiles}
        onDeletePhoto={photoApi.onDeletePhoto}
      />

      {loading ? (
        <div className="panel glass yes-store-page__loading"><div className="loader-ring" /></div>
      ) : (
        <section className="panel glass">
          <h2 className="yes-store-section-title">Rows</h2>
          <LocationCardGrid
            items={items}
            photosById={rowPhotos}
            onSelect={item => navigate(`${BASE}/rack/${location.rackId}/row/${item.id}`)}
          />
        </section>
      )}
    </div>
  );
};
