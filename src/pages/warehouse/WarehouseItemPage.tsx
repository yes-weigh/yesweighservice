import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { BinNumber, RowNumber } from '../../types/yes-store';
import { formatLocationLabel } from '../../types/yes-store';
import { getItem, parseRouteLocation } from '../../lib/yesStore/data';
import { LocationBreadcrumb } from '../../components/yesStore/LocationBreadcrumb';
import { PhotoGallery } from '../../components/yesStore/PhotoGallery';
import { useYesStorePhotos } from '../../lib/yesStore/useYesStorePhotos';
import type { YesStoreItemDoc, YesStorePhoto } from '../../types/yes-store';

const BASE = '/warehouse';

export const WarehouseItemPage: React.FC = () => {
  const { rackId = '', rowNum = '', binNum = '', itemId = '' } = useParams();
  const navigate = useNavigate();
  const location = useMemo(
    () => parseRouteLocation(rackId, rowNum, binNum),
    [rackId, rowNum, binNum],
  );
  const [item, setItem] = useState<YesStoreItemDoc | null>(null);
  const [photos, setPhotos] = useState<YesStorePhoto[]>([]);
  const [loading, setLoading] = useState(true);

  const rowNumber = location?.rowNumber as RowNumber | undefined;
  const binNumber = location?.binNumber as BinNumber | undefined;

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const doc = await getItem(itemId);
      setItem(doc);
      setPhotos(doc?.photos ?? []);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (!location?.rowNumber || !location.binNumber || !itemId) {
      navigate(BASE, { replace: true });
      return;
    }
    void load();
  }, [itemId, load, location?.rackId, location?.rowNumber, location?.binNumber, navigate]);

  const photoApi = useYesStorePhotos({
    level: 'item',
    rackId: location?.rackId ?? '',
    rowNumber,
    binNumber,
    itemId,
    parentId: itemId,
    photos,
    onPhotosChange: setPhotos,
  });

  if (!location?.rowNumber || !location.binNumber || !itemId) return null;

  if (loading) {
    return (
      <div className="yes-store-page fade-in">
        <div className="panel glass yes-store-page__loading"><div className="loader-ring" /></div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="yes-store-page fade-in">
        <div className="panel glass">
          <p className="text-muted">Item not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="yes-store-page fade-in">
      <LocationBreadcrumb
        basePath={BASE}
        rackId={location.rackId}
        rowNumber={location.rowNumber}
        binNumber={location.binNumber}
        itemName={item.name}
      />

      <header className="yes-store-page__header panel glass">
        <div>
          <h1>{item.name}</h1>
          {item.notes && <p className="text-muted">{item.notes}</p>}
          <span className="yes-store-tag">
            {formatLocationLabel(location.rackId, location.rowNumber, location.binNumber)}
          </span>
        </div>
      </header>

      <PhotoGallery
        title="Item photos"
        photos={photos}
        uploading={photoApi.uploading}
        uploadProgress={photoApi.uploadProgress}
        onAddFiles={photoApi.onAddFiles}
        onDeletePhoto={photoApi.onDeletePhoto}
      />
    </div>
  );
};
