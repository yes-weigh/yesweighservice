import { useCallback, useState } from 'react';
import { appendPhoto, removePhoto } from '../../lib/yesStore/data';
import { deleteYesStorePhotoFile, uploadYesStorePhoto } from '../../lib/yesStore/photos';
import type { BinNumber, RowNumber, YesStorePhoto } from '../../types/yes-store';

type PhotoLevel = 'rack' | 'row' | 'bin' | 'item';

type UseYesStorePhotosArgs = {
  level: PhotoLevel;
  rackId: string;
  rowNumber?: RowNumber;
  binNumber?: BinNumber;
  itemId?: string;
  parentId: string;
  photos: YesStorePhoto[];
  onPhotosChange: (photos: YesStorePhoto[]) => void;
};

export function useYesStorePhotos({
  level,
  rackId,
  rowNumber,
  binNumber,
  itemId,
  parentId,
  photos,
  onPhotosChange,
}: UseYesStorePhotosArgs) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const ids = { rackId, rowNumber, binNumber, itemId };

  const onAddFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const added: YesStorePhoto[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const photo = await uploadYesStorePhoto(level, parentId, file, pct => {
          const overall = Math.round(((i + pct / 100) / files.length) * 100);
          setUploadProgress(overall);
        });
        await appendPhoto(level, ids, photo);
        added.push(photo);
      }
      onPhotosChange([...photos, ...added]);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }, [binNumber, ids, itemId, level, onPhotosChange, parentId, photos, rackId, rowNumber]);

  const onDeletePhoto = useCallback(async (photo: YesStorePhoto) => {
    await removePhoto(level, ids, photo.id);
    await deleteYesStorePhotoFile(photo);
    onPhotosChange(photos.filter(p => p.id !== photo.id));
  }, [binNumber, ids, itemId, level, onPhotosChange, photos, rackId, rowNumber]);

  return { uploading, uploadProgress, onAddFiles, onDeletePhoto };
}
