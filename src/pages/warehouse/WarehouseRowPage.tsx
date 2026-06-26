import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BIN_NUMBERS, type RowNumber } from '../../types/yes-store';
import { ensureRow, getBin, parseRouteLocation } from '../../lib/yesStore/data';
import { LocationBreadcrumb } from '../../components/yesStore/LocationBreadcrumb';
import { LocationCardGrid } from '../../components/yesStore/LocationCardGrid';
import { PhotoGallery } from '../../components/yesStore/PhotoGallery';
import { useYesStorePhotos } from '../../lib/yesStore/useYesStorePhotos';
import type { YesStorePhoto } from '../../types/yes-store';

const BASE = '/warehouse';

export const WarehouseRowPage: React.FC = () => {
  const { rackId = '', rowNum = '' } = useParams();
  const navigate = useNavigate();
  const location = parseRouteLocation(rackId, rowNum);
  const [rowPhotos, setRowPhotos] = useState<YesStorePhoto[]>([]);
  const [binPhotos, setBinPhotos] = useState<Record<string, YesStorePhoto[]>>({});
  const [loading, setLoading] = useState(true);

  const rowNumber = location?.rowNumber as RowNumber | undefined;
  const normalizedRackId = location?.rackId ?? '';

  const load = useCallback(async () => {
    if (!location?.rowNumber) return;
    setLoading(true);
    try {
      const row = await ensureRow(location.rackId, location.rowNumber);
      setRowPhotos(row.photos ?? []);
      const bins: Record<string, YesStorePhoto[]> = {};
      await Promise.all(
        BIN_NUMBERS.map(async binNumber => {
          const bin = await getBin(location.rackId, location.rowNumber!, binNumber);
          bins[String(binNumber)] = bin?.photos ?? [];
        }),
      );
      setBinPhotos(bins);
    } finally {
      setLoading(false);
    }
  }, [location]);

  useEffect(() => {
    if (!location?.rowNumber) {
      navigate(BASE, { replace: true });
      return;
    }
    void load();
  }, [load, location, navigate]);

  const photoApi = useYesStorePhotos({
    level: 'row',
    rackId: normalizedRackId,
    rowNumber,
    parentId: `${normalizedRackId}_${rowNumber}`,
    photos: rowPhotos,
    onPhotosChange: setRowPhotos,
  });

  const items = useMemo(
    () => BIN_NUMBERS.map(n => ({ id: String(n), label: String(n) })),
    [],
  );

  if (!location?.rowNumber) return null;

  return (
    <div className="yes-store-page fade-in">
      <LocationBreadcrumb
        basePath={BASE}
        rackId={location.rackId}
        rowNumber={location.rowNumber}
      />

      <header className="yes-store-page__header panel glass">
        <div>
          <h1>Rack {location.rackId.toUpperCase()} · Row {location.rowNumber}</h1>
          <p className="text-muted text-sm">Bins 1–9</p>
        </div>
      </header>

      <PhotoGallery
        title="Row photos"
        photos={rowPhotos}
        uploading={photoApi.uploading}
        uploadProgress={photoApi.uploadProgress}
        onAddFiles={photoApi.onAddFiles}
        onDeletePhoto={photoApi.onDeletePhoto}
      />

      {loading ? (
        <div className="panel glass yes-store-page__loading"><div className="loader-ring" /></div>
      ) : (
        <section className="panel glass">
          <h2 className="yes-store-section-title">Bins</h2>
          <LocationCardGrid
            items={items}
            photosById={binPhotos}
            onSelect={item =>
              navigate(`${BASE}/rack/${location.rackId}/row/${location.rowNumber}/bin/${item.id}`)
            }
          />
        </section>
      )}
    </div>
  );
};
