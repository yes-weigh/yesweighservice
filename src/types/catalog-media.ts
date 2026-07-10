export type CatalogMediaKind = 'image' | 'pdf' | 'video' | 'other';

export interface CatalogMediaFile {
  id: string;
  fileName: string;
  contentType: string;
  kind: CatalogMediaKind;
  url: string;
  storagePath: string;
  sizeBytes: number;
  caption: string | null;
  uploadedAt: string;
  uploadedByUid: string | null;
  uploadedByName: string | null;
}

export interface CatalogMediaNote {
  id: string;
  text: string;
  createdAt: string;
  createdByUid: string | null;
  createdByName: string | null;
  updatedAt: string | null;
}

export interface CatalogProductMediaDoc {
  id: string;
  catalogProductId: string;
  files: CatalogMediaFile[];
  notes: CatalogMediaNote[];
  updatedAt: string;
  updatedByUid: string | null;
  updatedByName: string | null;
}

export function catalogMediaKindFromContentType(contentType: string): CatalogMediaKind {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('video/')) return 'video';
  return 'other';
}
