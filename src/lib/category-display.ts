export interface CategoryTheme {
  bg: string;
  accent: string;
  badge: string;
}

export const CATEGORY_THEMES: CategoryTheme[] = [
  { bg: '#e8f4fd', accent: '#1d4f8c', badge: '#cce5f8' },
  { bg: '#e8faf0', accent: '#0f6b42', badge: '#c4edd8' },
  { bg: '#fff4e8', accent: '#b45309', badge: '#fde4c8' },
  { bg: '#f3e8ff', accent: '#6b21a8', badge: '#e4d0fc' },
  { bg: '#fef3e8', accent: '#c2410c', badge: '#fddfc8' },
  { bg: '#e8f8f8', accent: '#0f766e', badge: '#c8eeec' },
  { bg: '#fce8f0', accent: '#9d174d', badge: '#f8d4e4' },
  { bg: '#eef2ff', accent: '#3730a3', badge: '#d8ddfc' },
  { bg: '#fef9e8', accent: '#92400e', badge: '#fcefc8' },
  { bg: '#f0fdf4', accent: '#166534', badge: '#d8f5e0' },
];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'weighing import': 'Imported weighing scales & precision equipment',
  'weighing india': 'Made-in-India weighing solutions',
  'printing scales': 'Label printing & receipt weighing scales',
  'analytical scales': 'High-precision lab & analytical balances',
  'scangle it': 'SCANGLE IT weighing products',
  indicators: 'Digital weight indicators & displays',
  'industrial scales': 'Heavy-duty industrial weighing systems',
  'counting machines': 'Piece counting & inventory scales',
  'it accessories': 'Cables, printers, stands & accessories',
  sanoft: 'SANOFT weighing products & solutions',
};

export function getCategoryTheme(index: number): CategoryTheme {
  return CATEGORY_THEMES[index % CATEGORY_THEMES.length]!;
}

export function getCategoryDescription(name: string): string {
  const key = name.trim().toLowerCase();
  if (CATEGORY_DESCRIPTIONS[key]) return CATEGORY_DESCRIPTIONS[key]!;

  const readable = name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return `Browse ${readable} products`;
}

export function formatCategoryItemCount(count: number): string {
  return `${count} Item${count === 1 ? '' : 's'}`;
}
