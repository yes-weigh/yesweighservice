import React, { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { CatalogMediaFile, CatalogMediaNote, CatalogProductMediaDoc } from '../../types/catalog-media';
import {
  addCatalogMediaNote,
  deleteCatalogMediaFile,
  deleteCatalogMediaNote,
  getCatalogProductMedia,
  updateCatalogMediaNote,
  uploadCatalogMediaFile,
} from '../../lib/catalogMedia/data';

type ProductMediaPanelProps = {
  catalogProductId: string;
  open: boolean;
  canWrite: boolean;
  actorUid: string;
  actorName?: string | null;
  embedded?: boolean;
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileKindIcon({ kind }: { kind: CatalogMediaFile['kind'] }) {
  if (kind === 'pdf') return <FileText size={18} aria-hidden />;
  if (kind === 'video') return <Film size={18} aria-hidden />;
  return <ImageIcon size={18} aria-hidden />;
}

export const ProductMediaPanel: React.FC<ProductMediaPanelProps> = ({
  catalogProductId,
  open,
  canWrite,
  actorUid,
  actorName = null,
  embedded = false,
}) => {
  const [doc, setDoc] = useState<CatalogProductMediaDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !catalogProductId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getCatalogProductMedia(catalogProductId)
      .then(result => {
        if (!cancelled) setDoc(result);
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load media.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, catalogProductId]);

  const files = doc?.files ?? [];
  const notes = doc?.notes ?? [];

  const handleUpload = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file || !canWrite || !actorUid) return;
    setUploading(true);
    setError(null);
    try {
      const next = await uploadCatalogMediaFile({
        catalogProductId,
        file,
        actorUid,
        actorName,
      });
      setDoc(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteFile = async (file: CatalogMediaFile) => {
    if (!canWrite || !actorUid) return;
    if (!window.confirm(`Delete “${file.fileName}”?`)) return;
    setBusyId(file.id);
    setError(null);
    try {
      const next = await deleteCatalogMediaFile({
        catalogProductId,
        file,
        actorUid,
        actorName,
      });
      setDoc(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete file.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddNote = async () => {
    if (!canWrite || !actorUid || !noteText.trim()) return;
    setBusyId('note-add');
    setError(null);
    try {
      const next = await addCatalogMediaNote({
        catalogProductId,
        text: noteText,
        actorUid,
        actorName,
      });
      setDoc(next);
      setNoteText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add note.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveNote = async (note: CatalogMediaNote) => {
    if (!canWrite || !actorUid || !editNoteText.trim()) return;
    setBusyId(note.id);
    setError(null);
    try {
      const next = await updateCatalogMediaNote({
        catalogProductId,
        noteId: note.id,
        text: editNoteText,
        actorUid,
        actorName,
      });
      setDoc(next);
      setEditingNoteId(null);
      setEditNoteText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update note.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteNote = async (note: CatalogMediaNote) => {
    if (!canWrite || !actorUid) return;
    if (!window.confirm('Delete this note?')) return;
    setBusyId(note.id);
    setError(null);
    try {
      const next = await deleteCatalogMediaNote({
        catalogProductId,
        noteId: note.id,
        actorUid,
        actorName,
      });
      setDoc(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete note.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={`product-media-panel${embedded ? ' product-media-panel--embedded' : ''}`}>
      <div className="product-media-panel__head">
        <div>
          <h3 className="product-media-panel__title">Product media</h3>
          <p className="product-media-panel__subtitle text-muted text-sm">
            Images, PDFs, videos, and notes stored in Firebase (not synced to Zoho).
          </p>
        </div>
        {canWrite && (
          <div className="product-media-panel__head-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime"
              className="sr-only"
              onChange={e => void handleUpload(e.target.files)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading
                ? <Loader2 size={15} className="spin-icon" aria-hidden />
                : <Upload size={15} aria-hidden />}
              {uploading ? 'Uploading…' : 'Upload file'}
            </button>
          </div>
        )}
      </div>

      {error && <p className="product-media-panel__error text-sm">{error}</p>}

      {loading ? (
        <p className="text-muted text-sm">Loading media…</p>
      ) : (
        <>
          <section className="product-media-panel__section">
            <div className="product-media-panel__section-head">
              <h4>Files</h4>
              <span className="product-media-panel__section-count">{files.length}</span>
            </div>
            {files.length === 0 ? (
              <p className="text-muted text-sm">No media files yet.</p>
            ) : (
              <ul className="product-media-panel__files">
                {files.map(file => (
                  <li key={file.id} className="product-media-panel__file">
                    {file.kind === 'image' ? (
                      <button
                        type="button"
                        className="product-media-panel__thumb-btn"
                        onClick={() => setLightboxUrl(file.url)}
                        aria-label={`View ${file.fileName}`}
                      >
                        <img src={file.url} alt="" className="product-media-panel__thumb" />
                      </button>
                    ) : (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="product-media-panel__file-icon"
                        aria-label={`Open ${file.fileName}`}
                      >
                        <FileKindIcon kind={file.kind} />
                      </a>
                    )}
                    <div className="product-media-panel__file-meta">
                      <a href={file.url} target="_blank" rel="noreferrer" className="product-media-panel__file-name">
                        {file.fileName}
                      </a>
                      <p className="text-muted text-sm">
                        {file.kind.toUpperCase()} · {formatBytes(file.sizeBytes)}
                        {file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
                      </p>
                      {file.caption && <p className="product-media-panel__caption">{file.caption}</p>}
                    </div>
                    {canWrite && (
                      <button
                        type="button"
                        className="btn btn-sm product-media-panel__file-delete"
                        disabled={busyId === file.id}
                        title="Delete file"
                        aria-label={`Delete ${file.fileName}`}
                        onClick={() => void handleDeleteFile(file)}
                      >
                        {busyId === file.id
                          ? <Loader2 size={14} className="spin-icon" aria-hidden />
                          : <Trash2 size={14} aria-hidden />}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="product-media-panel__section">
            <div className="product-media-panel__section-head">
              <h4>Notes</h4>
              <span className="product-media-panel__section-count">{notes.length}</span>
            </div>

            {canWrite && (
              <div className="product-media-panel__note-compose">
                <textarea
                  className="product-media-panel__note-input"
                  rows={3}
                  placeholder="Add a text note…"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  disabled={busyId === 'note-add'}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!noteText.trim() || busyId === 'note-add'}
                  onClick={() => void handleAddNote()}
                >
                  {busyId === 'note-add'
                    ? <Loader2 size={14} className="spin-icon" aria-hidden />
                    : <Plus size={14} aria-hidden />}
                  Add note
                </button>
              </div>
            )}

            {notes.length === 0 ? (
              <p className="text-muted text-sm">No notes yet.</p>
            ) : (
              <ul className="product-media-panel__notes">
                {notes.map(note => (
                  <li key={note.id} className="product-media-panel__note">
                    {editingNoteId === note.id ? (
                      <>
                        <textarea
                          className="product-media-panel__note-input"
                          rows={3}
                          value={editNoteText}
                          onChange={e => setEditNoteText(e.target.value)}
                          disabled={busyId === note.id}
                        />
                        <div className="product-media-panel__note-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!editNoteText.trim() || busyId === note.id}
                            onClick={() => void handleSaveNote(note)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busyId === note.id}
                            onClick={() => {
                              setEditingNoteId(null);
                              setEditNoteText('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="product-media-panel__note-text">{note.text}</p>
                        <p className="text-muted text-sm">
                          {note.createdByName || 'Unknown'}
                          {note.createdAt
                            ? ` · ${new Date(note.createdAt).toLocaleString()}`
                            : ''}
                        </p>
                        {canWrite && (
                          <div className="product-media-panel__note-actions">
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busyId === note.id}
                              onClick={() => {
                                setEditingNoteId(note.id);
                                setEditNoteText(note.text);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busyId === note.id}
                              onClick={() => void handleDeleteNote(note)}
                            >
                              {busyId === note.id
                                ? <Loader2 size={14} className="spin-icon" aria-hidden />
                                : <Trash2 size={14} aria-hidden />}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {lightboxUrl && (
        <div
          className="product-media-panel__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Media preview"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className="product-media-panel__lightbox-close"
            aria-label="Close preview"
            onClick={() => setLightboxUrl(null)}
          >
            <X size={18} aria-hidden />
          </button>
          <img src={lightboxUrl} alt="" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
};
