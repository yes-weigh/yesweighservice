import React, { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { CatalogMediaFile, CatalogMediaKind, CatalogProductMediaDoc } from '../../types/catalog-media';
import {
  deleteCatalogMediaFile,
  getCatalogProductMedia,
  updateCatalogMediaFileCaption,
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

type PreviewState = {
  url: string;
  kind: CatalogMediaKind;
  title: string;
} | null;

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
  const [showUpload, setShowUpload] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingCaption, setPendingCaption] = useState('');
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [editCaptionText, setEditCaptionText] = useState('');
  const [preview, setPreview] = useState<PreviewState>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearPendingUpload = () => {
    setPendingFile(null);
    setPendingCaption('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    if (!open || !catalogProductId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setShowUpload(false);
    setPendingFile(null);
    setPendingCaption('');
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  const closeUpload = () => {
    setShowUpload(false);
    clearPendingUpload();
  };

  const handlePickFile = (fileList: FileList | null) => {
    const file = fileList?.[0] ?? null;
    setPendingFile(file);
    setError(null);
    if (!file && fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!pendingFile || !canWrite || !actorUid) return;
    const caption = pendingCaption.trim();
    if (!caption) {
      setError('Add a description before uploading.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const next = await uploadCatalogMediaFile({
        catalogProductId,
        file: pendingFile,
        caption,
        actorUid,
        actorName,
      });
      setDoc(next);
      closeUpload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (file: CatalogMediaFile) => {
    if (!canWrite || !actorUid) return;
    if (!window.confirm(`Delete “${file.caption?.trim() || file.fileName}”?`)) return;
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

  const handleSaveCaption = async (file: CatalogMediaFile) => {
    if (!canWrite || !actorUid) return;
    const caption = editCaptionText.trim();
    if (!caption) {
      setError('Description cannot be empty.');
      return;
    }
    setBusyId(file.id);
    setError(null);
    try {
      const next = await updateCatalogMediaFileCaption({
        catalogProductId,
        fileId: file.id,
        caption,
        actorUid,
        actorName,
      });
      setDoc(next);
      setEditingCaptionId(null);
      setEditCaptionText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update description.');
    } finally {
      setBusyId(null);
    }
  };

  const openPreview = (file: CatalogMediaFile) => {
    setPreview({
      url: file.url,
      kind: file.kind,
      title: file.caption?.trim() || file.fileName,
    });
  };

  return (
    <div className={`product-media-panel${embedded ? ' product-media-panel--embedded' : ''}`}>
      <div className="product-media-panel__head">
        <div>
          <h3 className="product-media-panel__title">Product media</h3>
          <p className="product-media-panel__subtitle text-muted text-sm">
            Images, PDFs, and videos stored in Firebase (not synced to Zoho).
          </p>
        </div>
      </div>

      {error && <p className="product-media-panel__error text-sm">{error}</p>}

      {loading ? (
        <p className="text-muted text-sm">Loading media…</p>
      ) : (
        <section className="product-media-panel__section">
          <div className="product-media-panel__section-head">
            <h4>Files</h4>
            <span className="product-media-panel__section-count">{files.length}</span>
            {canWrite && (
              <button
                type="button"
                className={[
                  'btn btn-sm product-media-panel__add-btn',
                  showUpload ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
                title={showUpload ? 'Close add media' : 'Add media'}
                aria-label={showUpload ? 'Close add media' : 'Add media'}
                aria-expanded={showUpload}
                onClick={() => (showUpload ? closeUpload() : setShowUpload(true))}
              >
                {showUpload ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
              </button>
            )}
          </div>

          {canWrite && showUpload && (
            <div className="product-media-panel__upload-compose">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime"
                className="sr-only"
                onChange={e => handlePickFile(e.target.files)}
              />
              <div className="product-media-panel__upload-file-row">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {pendingFile ? 'Change file' : 'Choose file'}
                </button>
                {pendingFile ? (
                  <p className="product-media-panel__pending-file text-sm">
                    {pendingFile.name}
                    <span className="text-muted"> · {formatBytes(pendingFile.size)}</span>
                  </p>
                ) : (
                  <p className="text-muted text-sm">No file selected</p>
                )}
                {pendingFile && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={uploading}
                    onClick={clearPendingUpload}
                    aria-label="Clear selected file"
                  >
                    <X size={14} aria-hidden />
                  </button>
                )}
              </div>
              <textarea
                className="product-media-panel__note-input"
                rows={2}
                placeholder="Description (required)…"
                value={pendingCaption}
                onChange={e => setPendingCaption(e.target.value)}
                disabled={uploading || !pendingFile}
                required
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!pendingFile || !pendingCaption.trim() || uploading}
                onClick={() => void handleUpload()}
              >
                {uploading
                  ? <Loader2 size={15} className="spin-icon" aria-hidden />
                  : <Upload size={15} aria-hidden />}
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          )}

          {files.length === 0 ? (
            <p className="text-muted text-sm">
              {canWrite ? 'No media files yet. Tap + to add one.' : 'No media files yet.'}
            </p>
          ) : (
            <ul className="product-media-panel__files">
              {files.map(file => (
                <li key={file.id} className="product-media-panel__file">
                  <button
                    type="button"
                    className={
                      file.kind === 'image'
                        ? 'product-media-panel__thumb-btn'
                        : 'product-media-panel__file-icon'
                    }
                    onClick={() => openPreview(file)}
                    aria-label={`Preview ${file.caption?.trim() || file.fileName}`}
                  >
                    {file.kind === 'image' ? (
                      <img src={file.url} alt="" className="product-media-panel__thumb" />
                    ) : (
                      <FileKindIcon kind={file.kind} />
                    )}
                  </button>
                  <div className="product-media-panel__file-meta">
                    {editingCaptionId === file.id ? (
                      <div className="product-media-panel__caption-edit">
                        <textarea
                          className="product-media-panel__note-input"
                          rows={2}
                          value={editCaptionText}
                          onChange={e => setEditCaptionText(e.target.value)}
                          disabled={busyId === file.id}
                          placeholder="Description…"
                          aria-label="File description"
                        />
                        <div className="product-media-panel__note-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!editCaptionText.trim() || busyId === file.id}
                            onClick={() => void handleSaveCaption(file)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busyId === file.id}
                            onClick={() => {
                              setEditingCaptionId(null);
                              setEditCaptionText('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="product-media-panel__title-row">
                          <button
                            type="button"
                            className={[
                              'product-media-panel__file-title',
                              file.caption ? '' : 'product-media-panel__file-title--empty',
                            ].filter(Boolean).join(' ')}
                            onClick={() => openPreview(file)}
                          >
                            {file.caption?.trim() || 'No description'}
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              className="product-media-panel__edit-caption-btn"
                              disabled={busyId === file.id}
                              title="Edit description"
                              aria-label="Edit description"
                              onClick={() => {
                                setEditingCaptionId(file.id);
                                setEditCaptionText(file.caption ?? '');
                              }}
                            >
                              <Pencil size={14} aria-hidden />
                            </button>
                          )}
                        </div>
                        <p className="text-muted text-sm product-media-panel__file-meta-line">
                          {file.kind.toUpperCase()} · {formatBytes(file.sizeBytes)}
                          {file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
                        </p>
                      </>
                    )}
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      className="btn btn-sm product-media-panel__file-delete"
                      disabled={busyId === file.id}
                      title="Delete file"
                      aria-label={`Delete ${file.caption?.trim() || file.fileName}`}
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
      )}

      {preview && (
        <div
          className="product-media-panel__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={preview.title}
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            className="product-media-panel__lightbox-close"
            aria-label="Close preview"
            onClick={() => setPreview(null)}
          >
            <X size={18} aria-hidden />
          </button>
          <div
            className="product-media-panel__lightbox-body"
            onClick={e => e.stopPropagation()}
          >
            {preview.kind === 'image' && (
              <img src={preview.url} alt={preview.title} />
            )}
            {preview.kind === 'pdf' && (
              <iframe
                title={preview.title}
                src={preview.url}
                className="product-media-panel__lightbox-frame"
              />
            )}
            {preview.kind === 'video' && (
              <video
                src={preview.url}
                controls
                autoPlay
                className="product-media-panel__lightbox-video"
              />
            )}
            {preview.kind === 'other' && (
              <a href={preview.url} target="_blank" rel="noreferrer" className="btn btn-primary">
                Open file
              </a>
            )}
            <p className="product-media-panel__lightbox-caption">{preview.title}</p>
          </div>
        </div>
      )}
    </div>
  );
};
