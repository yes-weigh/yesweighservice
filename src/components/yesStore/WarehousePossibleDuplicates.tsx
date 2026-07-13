import React from 'react';
import { ArrowLeft, Copy } from 'lucide-react';
import { readItemQuantity, type YesStoreItemDoc } from '../../types/yes-store';
import { findPossibleDuplicateBinGroups } from '../../lib/yesStore/possibleDuplicates';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import { YesStorePhotoImg } from './YesStorePhotoImg';

type WarehousePossibleDuplicatesProps = {
  items: YesStoreItemDoc[];
  loading?: boolean;
  onBack: () => void;
  onItemClick: (item: YesStoreItemDoc) => void;
};

export const WarehousePossibleDuplicates: React.FC<WarehousePossibleDuplicatesProps> = ({
  items,
  loading = false,
  onBack,
  onItemClick,
}) => {
  const groups = findPossibleDuplicateBinGroups(items);
  const totalExtra = groups.reduce((sum, group) => sum + Math.max(0, group.items.length - 1), 0);

  return (
    <div className="warehouse-app warehouse-duplicates">
      <header className="warehouse-app__bar">
        <button
          type="button"
          className="warehouse-duplicates__back"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={20} aria-hidden />
        </button>
        <h1 className="warehouse-app__title">Possible duplications</h1>
      </header>

      <main className="warehouse-app__main">
        <p className="warehouse-duplicates__intro text-muted text-sm">
          Records in the same bin that share the same quantity. Often happens when Add item was
          used instead of Replace. Open a record to edit, replace, or delete.
        </p>

        {loading ? (
          <div className="warehouse-app__loading">
            <div className="loader-ring" />
          </div>
        ) : groups.length === 0 ? (
          <p className="warehouse-app__empty text-muted">
            No possible duplications found. No bin has multiple records with the same quantity.
          </p>
        ) : (
          <>
            <p className="warehouse-duplicates__summary">
              {groups.length} group{groups.length === 1 ? '' : 's'} · {totalExtra} extra record
              {totalExtra === 1 ? '' : 's'}
            </p>
            <div className="warehouse-duplicates__groups">
              {groups.map(group => (
                <section key={group.key} className="warehouse-duplicates__group">
                  <header className="warehouse-duplicates__group-head">
                    <span className="warehouse-duplicates__location">
                      {group.locationLabel}
                      <span className="warehouse-duplicates__qty-pill">Qty {group.quantity}</span>
                    </span>
                    <span className="warehouse-duplicates__count">
                      {group.items.length} records
                    </span>
                  </header>
                  <ul className="warehouse-duplicates__items">
                    {group.items.map((item, index) => {
                      const photo = item.photos?.[0];
                      const stamped = item.countedAt ?? item.updatedAt;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="warehouse-duplicates__item"
                            onClick={() => onItemClick(item)}
                          >
                            <span className="warehouse-duplicates__thumb">
                              {photo ? (
                                <YesStorePhotoImg photo={photo} emptyClassName="warehouse-duplicates__thumb-empty" />
                              ) : (
                                <span className="warehouse-duplicates__thumb-empty">—</span>
                              )}
                            </span>
                            <span className="warehouse-duplicates__item-body">
                              <span className="warehouse-duplicates__item-title">
                                Record {index + 1}
                                {item.catalogProductName?.trim()
                                  ? ` · ${item.catalogProductName.trim()}`
                                  : ''}
                              </span>
                              <span className="warehouse-duplicates__item-meta text-muted text-sm">
                                Qty {readItemQuantity(item)}
                                {stamped ? ` · ${formatAuditDateTime(stamped)}` : ''}
                              </span>
                            </span>
                            <Copy size={16} className="warehouse-duplicates__item-icon" aria-hidden />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
};
