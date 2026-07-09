import React, { useRef, useState } from 'react';
import { Camera, ChevronRight, FolderOpen, RefreshCw } from 'lucide-react';
import {
  formatCategoryItemCount,
  getCategoryDescription,
  getCategoryTheme,
} from '../../lib/category-display';
import { CategoryThumbnail } from './CategoryThumbnail';
import type { CatalogCategory } from '../../types/catalog';

export interface CategoryBrowseCardProps {
  category: CatalogCategory;
  index: number;
  onClick: () => void;
  editable?: boolean;
  onUploadThumb?: (file: File) => Promise<void>;
  dragProps?: {
    draggable: boolean;
    onDragStart: React.DragEventHandler;
    onDragOver: React.DragEventHandler;
    onDragLeave: React.DragEventHandler;
    onDrop: React.DragEventHandler;
    onDragEnd: React.DragEventHandler;
  };
  /** Title + image only — no subtitle or item count */
  simple?: boolean;
}

export const CategoryBrowseCard: React.FC<CategoryBrowseCardProps> = ({
  category,
  index,
  onClick,
  editable = false,
  onUploadThumb,
  dragProps,
  simple = false,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const theme = getCategoryTheme(index);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadThumb) return;
    e.target.value = '';
    setUploading(true);
    try {
      await onUploadThumb(file);
    } finally {
      setUploading(false);
    }
  };

  const cardStyle = {
    '--cat-bg': theme.bg,
    '--cat-accent': theme.accent,
    '--cat-badge': theme.badge,
  } as React.CSSProperties;

  const sharedClass = [
    'catalog-category-card',
    simple ? 'catalog-category-card--simple' : '',
    editable ? 'catalog-category-card--editable' : '',
    dragOver ? 'catalog-category-card--drag-over' : '',
  ].filter(Boolean).join(' ');

  const content = (
    <>
      <div className="catalog-category-card__body">
        <div className="catalog-category-card__text">
          <h4 className="catalog-category-card__title">{category.name}</h4>
          {!simple && (
            <p className="catalog-category-card__desc">
              {getCategoryDescription(category.name)}
            </p>
          )}
        </div>
        {!simple && (
          <span className="catalog-category-card__count">
            {formatCategoryItemCount(category.productCount, category.totalProductCount)}
            <ChevronRight size={12} strokeWidth={2.5} aria-hidden />
          </span>
        )}
      </div>
      {simple && (
        <img
          src="/genuinelogo.png"
          alt="Genuine spare parts"
          className="catalog-category-card__genuine-badge"
        />
      )}
      <div className="catalog-category-card__visual" aria-hidden>
        {category.thumbnailUrl ? (
          <CategoryThumbnail src={category.thumbnailUrl} />
        ) : (
          <FolderOpen size={36} className="catalog-category-card__fallback" />
        )}
      </div>
      {editable && onUploadThumb && (
        <>
          <button
            type="button"
            className="catalog-category-card__upload"
            title="Change category image"
            onClick={e => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
          >
            {uploading
              ? <RefreshCw size={13} className="spin-icon" />
              : <Camera size={13} />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="catalog-category-card__file-input"
            aria-label={`Upload image for ${category.name}`}
            onChange={e => void handleFile(e)}
            onClick={e => e.stopPropagation()}
          />
        </>
      )}
    </>
  );

  if (editable) {
    return (
      <div
        {...dragProps}
        role="button"
        tabIndex={0}
        style={cardStyle}
        className={sharedClass}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
          dragProps?.onDragOver(e);
        }}
        onDragLeave={e => {
          setDragOver(false);
          dragProps?.onDragLeave(e);
        }}
        onDrop={e => {
          setDragOver(false);
          dragProps?.onDrop(e);
        }}
        onClick={onClick}
      >
        {content}
      </div>
    );
  }

  return (
    <button type="button" style={cardStyle} className={sharedClass} onClick={onClick}>
      {content}
    </button>
  );
};
