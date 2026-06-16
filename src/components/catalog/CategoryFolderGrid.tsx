import React, { useEffect, useRef, useState } from 'react';
import type { CatalogCategory } from '../../types/catalog';
import { CategoryBrowseCard } from './CategoryBrowseCard';
import { CategoryBrowseSection } from './CategoryBrowseSection';

export interface CategoryFolderGridProps {
  categories: CatalogCategory[];
  onCategoryClick: (categoryId: string) => void;
  onReorder: (categories: CatalogCategory[]) => void;
  onUploadThumbnail: (categoryId: string, categoryName: string, file: File) => Promise<string | null>;
  simpleCategoryTiles?: boolean;
}

export const CategoryFolderGrid: React.FC<CategoryFolderGridProps> = ({
  categories,
  onCategoryClick,
  onReorder,
  onUploadThumbnail,
  simpleCategoryTiles = false,
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

    const next = [...localCategories];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(dropIdx, 0, moved);
    const withOrder = next.map((cat, index) => ({ ...cat, displayOrder: index }));
    setLocalCategories(withOrder);
    void Promise.resolve().then(() => onReorder(withOrder));
    dragIdx.current = null;
  };

  const handleDragEnd: React.DragEventHandler = () => {
    dragIdx.current = null;
  };

  return (
    <CategoryBrowseSection
      hint={(
        <p className="catalog-categories__hint text-muted text-sm">
          Drag to reorder · hover a card to change its image
        </p>
      )}
    >
      {localCategories.map((category, idx) => (
        <CategoryBrowseCard
          key={category.id}
          category={category}
          index={idx}
          editable
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
          simple={simpleCategoryTiles}
        />
      ))}
    </CategoryBrowseSection>
  );
};
