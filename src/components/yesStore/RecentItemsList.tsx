import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ImageIcon } from 'lucide-react';
import { itemDetailPath } from '../../lib/yesStore/data';
import { formatRelativeTime } from '../../lib/yesStore/format';
import { formatLocationLabel } from '../../types/yes-store';
import type { YesStoreItemDoc } from '../../types/yes-store';

type RecentItemsListProps = {
  basePath: string;
  items: YesStoreItemDoc[];
  loading?: boolean;
};

export const RecentItemsList: React.FC<RecentItemsListProps> = ({
  basePath,
  items,
  loading,
}) => (
  <section className="panel glass yes-store-recent">
    <div className="yes-store-recent__header">
      <div>
        <h2>Recently updated</h2>
        <p className="text-muted text-sm">Latest items photographed in the warehouse</p>
      </div>
      {loading && <div className="loader-ring loader-ring--sm" aria-label="Loading" />}
    </div>

    {!loading && items.length === 0 ? (
      <p className="text-muted yes-store-recent__empty">
        No items yet. Open a rack, row, and bin to add your first photographed item.
      </p>
    ) : (
      <ul className="yes-store-recent__list">
        {items.map(item => {
          const thumb = item.photos?.[0]?.url;
          const missingPhotos = !item.photos?.length;
          const location = formatLocationLabel(item.rackId, item.rowNumber, item.binNumber);
          return (
            <li
              key={item.id}
              className={`yes-store-recent__row ${missingPhotos ? 'is-warning' : ''}`}
            >
              <Link to={itemDetailPath(basePath, item)} className="yes-store-recent__link">
                <div className="yes-store-recent__thumb">
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" />
                  ) : (
                    <ImageIcon size={22} aria-hidden />
                  )}
                </div>
                <div className="yes-store-recent__body">
                  <strong>{item.name}</strong>
                  <span className="yes-store-recent__location">{location}</span>
                  {item.notes && (
                    <span className="yes-store-recent__notes text-muted">{item.notes}</span>
                  )}
                  {missingPhotos && (
                    <span className="yes-store-items__warn">
                      <AlertTriangle size={14} aria-hidden />
                      Needs photos
                    </span>
                  )}
                </div>
                <div className="yes-store-recent__meta">
                  <span className="yes-store-recent__time">
                    {formatRelativeTime(item.updatedAt)}
                  </span>
                  <span className="text-muted text-sm">
                    {item.photos?.length ?? 0} photo{(item.photos?.length ?? 0) === 1 ? '' : 's'}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);
