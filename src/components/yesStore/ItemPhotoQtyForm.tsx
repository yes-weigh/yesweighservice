export type PendingSlot = {
  id: string;
  file: File;
  previewUrl: string;
};

export type PhotoSlot =
  | { kind: 'saved'; photo: import('../../types/yes-store').YesStorePhoto }
  | { kind: 'pending'; pending: PendingSlot; uploading?: boolean };

export function pendingFromFile(file: File): PendingSlot {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    previewUrl: URL.createObjectURL(file),
  };
}
