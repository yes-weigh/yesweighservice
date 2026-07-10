import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../../firebase';
import { compressImageForUpload } from '../compressImage';
import type {
  CatalogMediaFile,
  CatalogMediaNote,
  CatalogProductMediaDoc,
} from '../../types/catalog-media';
import { catalogMediaKindFromContentType } from '../../types/catalog-media';

const COLLECTION = 'catalogProductMedia';
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_NOTES = 100;
const MAX_FILES = 40;
const functions = getFunctions(app, 'asia-south1');

const now = () => new Date().toISOString();

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mediaDocRef(catalogProductId: string) {
  return doc(db, COLLECTION, catalogProductId);
}

function emptyMediaDoc(catalogProductId: string): CatalogProductMediaDoc {
  return {
    id: catalogProductId,
    catalogProductId,
    files: [],
    notes: [],
    updatedAt: now(),
    updatedByUid: null,
    updatedByName: null,
  };
}

function mapFile(row: Record<string, unknown>): CatalogMediaFile | null {
  const id = String(row.id ?? '').trim();
  const url = String(row.url ?? '').trim();
  const storagePath = String(row.storagePath ?? '').trim();
  if (!id || !url || !storagePath) return null;
  const contentType = String(row.contentType ?? 'application/octet-stream');
  return {
    id,
    fileName: String(row.fileName ?? 'file'),
    contentType,
    kind: (row.kind as CatalogMediaFile['kind'])
      ?? catalogMediaKindFromContentType(contentType),
    url,
    storagePath,
    sizeBytes: Number(row.sizeBytes ?? 0) || 0,
    caption: (row.caption as string | null) ?? null,
    uploadedAt: String(row.uploadedAt ?? ''),
    uploadedByUid: (row.uploadedByUid as string | null) ?? null,
    uploadedByName: (row.uploadedByName as string | null) ?? null,
  };
}

function mapNote(row: Record<string, unknown>): CatalogMediaNote | null {
  const id = String(row.id ?? '').trim();
  const text = String(row.text ?? '').trim();
  if (!id || !text) return null;
  return {
    id,
    text,
    createdAt: String(row.createdAt ?? ''),
    createdByUid: (row.createdByUid as string | null) ?? null,
    createdByName: (row.createdByName as string | null) ?? null,
    updatedAt: (row.updatedAt as string | null) ?? null,
  };
}

function mapMediaDoc(
  data: Record<string, unknown>,
  catalogProductId: string,
): CatalogProductMediaDoc {
  const files = Array.isArray(data.files)
    ? data.files
      .map(row => mapFile(row as Record<string, unknown>))
      .filter((f): f is CatalogMediaFile => f !== null)
    : [];
  const notes = Array.isArray(data.notes)
    ? data.notes
      .map(row => mapNote(row as Record<string, unknown>))
      .filter((n): n is CatalogMediaNote => n !== null)
    : [];
  return {
    id: catalogProductId,
    catalogProductId,
    files,
    notes,
    updatedAt: String(data.updatedAt ?? ''),
    updatedByUid: (data.updatedByUid as string | null) ?? null,
    updatedByName: (data.updatedByName as string | null) ?? null,
  };
}

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read file.'));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Could not read file.'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

export async function getCatalogProductMedia(
  catalogProductId: string,
): Promise<CatalogProductMediaDoc | null> {
  const snap = await getDoc(mediaDocRef(catalogProductId));
  if (!snap.exists()) return null;
  return mapMediaDoc(snap.data() as Record<string, unknown>, catalogProductId);
}

/** Product IDs that have at least one Firebase media file. */
export async function listCatalogProductIdsWithMediaFiles(): Promise<Set<string>> {
  const snap = await getDocs(collection(db, COLLECTION));
  const ids = new Set<string>();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    const files = Array.isArray(data.files) ? data.files : [];
    const hasFile = files.some(row => {
      if (!row || typeof row !== 'object') return false;
      const item = row as Record<string, unknown>;
      return Boolean(String(item.url ?? '').trim() && String(item.storagePath ?? '').trim());
    });
    if (hasFile) ids.add(docSnap.id);
  }
  return ids;
}

async function saveMediaDoc(docData: CatalogProductMediaDoc): Promise<CatalogProductMediaDoc> {
  await setDoc(mediaDocRef(docData.catalogProductId), docData, { merge: false });
  return docData;
}

export async function uploadCatalogMediaFile(input: {
  catalogProductId: string;
  file: File;
  caption?: string | null;
  actorUid: string;
  actorName?: string | null;
}): Promise<CatalogProductMediaDoc> {
  const existing = await getCatalogProductMedia(input.catalogProductId)
    ?? emptyMediaDoc(input.catalogProductId);
  if (existing.files.length >= MAX_FILES) {
    throw new Error(`Maximum ${MAX_FILES} media files per product.`);
  }

  let uploadFile = input.file;
  if (input.file.type.startsWith('image/')) {
    uploadFile = await compressImageForUpload(input.file, { maxBytes: 1_200_000 });
  }
  if (uploadFile.size > MAX_FILE_BYTES) {
    throw new Error('File must be under 40 MB.');
  }

  const fileId = newId('media');
  try {
    const fn = httpsCallable<
      {
        catalogProductId: string;
        fileId: string;
        fileName: string;
        contentType: string;
        fileBase64: string;
        caption?: string | null;
      },
      CatalogMediaFile
    >(functions, 'uploadCatalogMediaFileFn', { timeout: 180_000 });
    const result = await fn({
      catalogProductId: input.catalogProductId,
      fileId,
      fileName: uploadFile.name || 'file',
      contentType: uploadFile.type || 'application/octet-stream',
      fileBase64: await fileToBase64(uploadFile),
      caption: input.caption?.trim() || null,
    });
    const stamp = now();
    const next: CatalogProductMediaDoc = {
      ...existing,
      files: [...existing.files, result.data],
      updatedAt: stamp,
      updatedByUid: input.actorUid,
      updatedByName: input.actorName?.trim() || null,
    };
    return saveMediaDoc(next);
  } catch (err) {
    throw callableError(err, 'Could not upload media file.');
  }
}

export async function deleteCatalogMediaFile(input: {
  catalogProductId: string;
  file: CatalogMediaFile;
  actorUid: string;
  actorName?: string | null;
}): Promise<CatalogProductMediaDoc> {
  const existing = await getCatalogProductMedia(input.catalogProductId);
  if (!existing) throw new Error('No media found for this product.');

  try {
    const fn = httpsCallable<{ storagePath: string }, { deleted: boolean }>(
      functions,
      'deleteCatalogMediaFileFn',
      { timeout: 60_000 },
    );
    await fn({ storagePath: input.file.storagePath });
  } catch {
    // continue — remove Firestore entry even if storage already gone
  }

  const stamp = now();
  return saveMediaDoc({
    ...existing,
    files: existing.files.filter(f => f.id !== input.file.id),
    updatedAt: stamp,
    updatedByUid: input.actorUid,
    updatedByName: input.actorName?.trim() || null,
  });
}

export async function updateCatalogMediaFileCaption(input: {
  catalogProductId: string;
  fileId: string;
  caption: string | null;
  actorUid: string;
  actorName?: string | null;
}): Promise<CatalogProductMediaDoc> {
  const existing = await getCatalogProductMedia(input.catalogProductId);
  if (!existing) throw new Error('No media found for this product.');
  const stamp = now();
  return saveMediaDoc({
    ...existing,
    files: existing.files.map(file => (
      file.id === input.fileId
        ? { ...file, caption: input.caption?.trim() || null }
        : file
    )),
    updatedAt: stamp,
    updatedByUid: input.actorUid,
    updatedByName: input.actorName?.trim() || null,
  });
}

export async function addCatalogMediaNote(input: {
  catalogProductId: string;
  text: string;
  actorUid: string;
  actorName?: string | null;
}): Promise<CatalogProductMediaDoc> {
  const text = input.text.trim();
  if (!text) throw new Error('Note cannot be empty.');
  const existing = await getCatalogProductMedia(input.catalogProductId)
    ?? emptyMediaDoc(input.catalogProductId);
  if (existing.notes.length >= MAX_NOTES) {
    throw new Error(`Maximum ${MAX_NOTES} notes per product.`);
  }
  const stamp = now();
  const note: CatalogMediaNote = {
    id: newId('note'),
    text,
    createdAt: stamp,
    createdByUid: input.actorUid,
    createdByName: input.actorName?.trim() || null,
    updatedAt: null,
  };
  return saveMediaDoc({
    ...existing,
    notes: [note, ...existing.notes],
    updatedAt: stamp,
    updatedByUid: input.actorUid,
    updatedByName: input.actorName?.trim() || null,
  });
}

export async function updateCatalogMediaNote(input: {
  catalogProductId: string;
  noteId: string;
  text: string;
  actorUid: string;
  actorName?: string | null;
}): Promise<CatalogProductMediaDoc> {
  const text = input.text.trim();
  if (!text) throw new Error('Note cannot be empty.');
  const existing = await getCatalogProductMedia(input.catalogProductId);
  if (!existing) throw new Error('No media found for this product.');
  const stamp = now();
  return saveMediaDoc({
    ...existing,
    notes: existing.notes.map(note => (
      note.id === input.noteId
        ? { ...note, text, updatedAt: stamp }
        : note
    )),
    updatedAt: stamp,
    updatedByUid: input.actorUid,
    updatedByName: input.actorName?.trim() || null,
  });
}

export async function deleteCatalogMediaNote(input: {
  catalogProductId: string;
  noteId: string;
  actorUid: string;
  actorName?: string | null;
}): Promise<CatalogProductMediaDoc> {
  const existing = await getCatalogProductMedia(input.catalogProductId);
  if (!existing) throw new Error('No media found for this product.');
  const stamp = now();
  return saveMediaDoc({
    ...existing,
    notes: existing.notes.filter(note => note.id !== input.noteId),
    updatedAt: stamp,
    updatedByUid: input.actorUid,
    updatedByName: input.actorName?.trim() || null,
  });
}
