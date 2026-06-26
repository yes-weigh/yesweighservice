import React from 'react';
import { ImageIcon } from 'lucide-react';
import type { YesStorePhoto } from '../../types/yes-store';

type LocationCardGridProps<T extends { id: string; label: string }> = {
  items: T[];
  photosById: Record<string, YesStorePhoto[]>;
  onSelect: (item: T) => void;
  emptyLabel?: string;
};

export function LocationCardGrid<T extends { id: string; label: string }>({
  items,
  photosById,
  onSelect,
  emptyLabel,
}: LocationCardGridProps<T>) {
  return (
    <div className="yes-store-grid">
      {items.map(item => {
        const photos = photosById[item.id] ?? [];
        const thumb = photos[0]?.url;
        return (
          <button
            key={item.id}
            type="button"
            className="yes-store-card"
            onClick={() => onSelect(item)}
          >
            <div className="yes-store-card__thumb">
              {thumb ? (
                <img src={thumb} alt="" loading="lazy" />
              ) : (
                <span className="yes-store-card__placeholder">{item.label}</span>
              )}
            </div>
            <div className="yes-store-card__meta">
              <strong>{item.label}</strong>
              <span className="text-muted text-sm">
                {photos.length} photo{photos.length === 1 ? '' : 's'}
              </span>
            </div>
          </button>
        );
      })}
      {!items.length && emptyLabel && (
        <p className="text-muted yes-store-grid__empty">{emptyLabel}</p>
      )}
    </div>
  );
}

export const LocationCardPlaceholder: React.FC<{ label: string }> = ({ label }) => (
  <div className="yes-store-card__placeholder-wrap">
    <ImageIcon size={28} aria-hidden />
    <span>{label}</span>
  </div>
);
