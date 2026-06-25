import { isImageFile, isVideoFile } from './supportAttachments';

export type RecentMediaItem = {
  id: string;
  previewUrl: string;
  kind: 'image' | 'video';
  file: File;
};

const MAX_RECENT = 24;
const items: RecentMediaItem[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

export function subscribeRecentMedia(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentMedia(): readonly RecentMediaItem[] {
  return items;
}

export function pushRecentMedia(file: File): void {
  if (!isImageFile(file) && !isVideoFile(file)) return;

  const previewUrl = URL.createObjectURL(file);
  const kind = isVideoFile(file) ? 'video' : 'image';
  items.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    previewUrl,
    kind,
    file,
  });

  while (items.length > MAX_RECENT) {
    const removed = items.pop();
    if (removed) URL.revokeObjectURL(removed.previewUrl);
  }

  notify();
}
