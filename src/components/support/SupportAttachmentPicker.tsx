import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Film, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import {
  MAX_SUPPORT_ATTACHMENTS,
  createPendingSupportFile,
  retainFileCopy,
  revokePendingSupportFiles,
  validateSupportFile,
  type PendingSupportFile,
} from '../../lib/supportAttachments';

export interface SupportAttachmentPickerHandle {
  openPicker: () => void;
}

interface SupportAttachmentPickerProps {
  files: PendingSupportFile[];
  onChange: (files: PendingSupportFile[]) => void;
  disabled?: boolean;
  /** WhatsApp-style composer: icon-only attach, previews above input bar */
  compact?: boolean;
  /** When compact, omit preview strip (parent renders it separately) */
  hidePreviews?: boolean;
}

export const SupportAttachmentPicker = forwardRef<SupportAttachmentPickerHandle, SupportAttachmentPickerProps>(
  function SupportAttachmentPicker(
    { files, onChange, disabled, compact, hidePreviews },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      openPicker: () => inputRef.current?.click(),
    }));

    const handlePick = (picked: FileList | null) => {
      void (async () => {
        if (!picked?.length) return;
        const next = [...files];
        for (const file of Array.from(picked)) {
          if (next.length >= MAX_SUPPORT_ATTACHMENTS) break;
          try {
            const retained = await retainFileCopy(file);
            const err = validateSupportFile(retained);
            if (err) {
              window.alert(err);
              continue;
            }
            next.push(createPendingSupportFile(retained));
          } catch (err) {
            window.alert(err instanceof Error ? err.message : `Could not read ${file.name}.`);
          }
        }
        onChange(next);
        if (inputRef.current) inputRef.current.value = '';
      })();
    };

    const removeFile = (id: string) => {
      const target = files.find(f => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      onChange(files.filter(f => f.id !== id));
    };

    if (compact) {
      return (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={e => handlePick(e.target.files)}
          />
          {!hidePreviews && files.length > 0 && (
            <ul className="support-attachment-picker__previews support-attachment-picker__previews--compact">
              {files.map(item => (
                <li key={item.id} className="support-attachment-picker__preview">
                  {item.kind === 'video' ? (
                    <video src={item.previewUrl} className="support-attachment-picker__media" muted />
                  ) : (
                    <img src={item.previewUrl} alt="" className="support-attachment-picker__media" />
                  )}
                  <span className="support-attachment-picker__badge" aria-hidden>
                    {item.kind === 'video' ? <Film size={12} /> : <ImageIcon size={12} />}
                  </span>
                  <button
                    type="button"
                    className="support-attachment-picker__remove"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removeFile(item.id)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    }

    return (
      <div className="support-attachment-picker">
        <div className="support-attachment-picker__toolbar">
          <button
            type="button"
            className="support-attachment-picker__add"
            disabled={disabled || files.length >= MAX_SUPPORT_ATTACHMENTS}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip size={16} />
            Add photos / videos
          </button>
          <span className="support-attachment-picker__hint text-muted text-sm">
            Up to {MAX_SUPPORT_ATTACHMENTS} files · images or videos (max 50 MB video)
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={e => handlePick(e.target.files)}
        />
        {files.length > 0 && (
          <ul className="support-attachment-picker__previews">
            {files.map(item => (
              <li key={item.id} className="support-attachment-picker__preview">
                {item.kind === 'video' ? (
                  <video src={item.previewUrl} className="support-attachment-picker__media" muted />
                ) : (
                  <img src={item.previewUrl} alt="" className="support-attachment-picker__media" />
                )}
                <span className="support-attachment-picker__badge" aria-hidden>
                  {item.kind === 'video' ? <Film size={12} /> : <ImageIcon size={12} />}
                </span>
                <button
                  type="button"
                  className="support-attachment-picker__remove"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removeFile(item.id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);

export function pendingFilesToUpload(files: PendingSupportFile[]): File[] {
  return files.map(f => f.file);
}

export function cleanupPendingFiles(files: PendingSupportFile[]): void {
  revokePendingSupportFiles(files);
}
