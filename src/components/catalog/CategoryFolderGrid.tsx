import React, { useEffect, useRef, useState } from 'react';
import { Camera, FolderOpen, RefreshCw } from 'lucide-react';
import type { CatalogCategory } from '../../types/catalog';

interface CategoryFolderCardProps {
  category: CatalogCategory;
  onClick: () => void;
  onUploadThumb: (file: File) => Promise<void>;
  dragProps?: {
    draggable: boolean;
    onDragStart: React.DragEventHandler;
    onDragOver: React.DragEventHandler;
    onDragLeave: React.DragEventHandler;
    onDrop: React.DragEventHandler;
    onDragEnd: React.DragEventHandler;
  };
}

function CategoryFolderCard({
  category,
  onClick,
  onUploadThumb,
  dragProps,
}: CategoryFolderCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      await onUploadThumb(file);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      {...dragProps}
      role="button"
      tabIndex={0}
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
      className={[
        'catalog-category catalog-category--editable panel glass',
        dragOver ? 'catalog-category--drag-over' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className="catalog-category__upload"
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
        className="catalog-category__file-input"
        aria-label={`Upload image for ${category.name}`}
        onChange={e => void handleFile(e)}
        onClick={e => e.stopPropagation()}
      />

      <div className="catalog-category__thumb">
        {category.thumbnailUrl ? (
          <img src={category.thumbnailUrl} alt={category.name} loading="lazy" />
        ) : (
          <FolderOpen size={42} className="catalog-category__icon" />
        )}
      </div>
      <div className="catalog-category__copy">
        <p>{category.name}</p>
        <span>{category.productCount}</span>
      </div>
    </div>
  );
}

export interface CategoryFolderGridProps {
  categories: CatalogCategory[];
  onCategoryClick: (categoryId: string) => void;
  onReorder: (categories: CatalogCategory[]) => void;
  onUploadThumbnail: (categoryId: string, categoryName: string, file: File) => Promise<string | null>;
}

export const CategoryFolderGrid: React.FC<CategoryFolderGridProps> = ({
  categories,
  onCategoryClick,
  onReorder,
  onUploadThumbnail,
}) => {
  const [localCategories, setLocalCategories] = useState<CatalogCategory[]>(categories);
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    setLocalCategories(categories);
  }, [categories]);

  const handleDragStart = (idx: number): React.DragEventHandler => e => {
    dragIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver: React.DragEventHandler = e => {
    e.preventDefault();
  };

  const handleDrop = (dropIdx: number): React.DragEventHandler => e => {
    e.preventDefault();
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === dropIdx) {
      dragIdx.current = null;
      return;
    }

    setLocalCategories(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(dropIdx, 0, moved);
      onReorder(next);
      return next;
    });
    dragIdx.current = null;
  };

  const handleDragEnd: React.DragEventHandler = () => {
    dragIdx.current = null;
  };

  return (
    <section className="catalog-categories">
      <div className="catalog-categories__heading">
        <h3>
          <FolderOpen size={14} />
          Browse categories
        </h3>
        <p className="catalog-categories__hint text-muted text-sm">
          Drag to reorder · hover a card to change its image
        </p>
      </div>
      <div className="catalog-categories__grid">
        {localCategories.map((category, idx) => (
          <CategoryFolderCard
            key={category.id}
            category={category}
            onClick={() => onCategoryClick(category.id)}
            onUploadThumb={file => onUploadThumbnail(category.id, category.name, file).then(() => undefined)}
            dragProps={{
              draggable: true,
              onDragStart: handleDragStart(idx),
              onDragOver: handleDragOver,
              onDragLeave: () => undefined,
              onDrop: handleDrop(idx),
              onDragEnd: handleDragEnd,
            }}
          />
        ))}
      </div>
    </section>
  );
};
