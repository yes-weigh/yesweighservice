import { FileText } from 'lucide-react';
import { useEffect } from 'react';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function documentSubtitle(fileName: string, mimeType: string, size: number): string {
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toUpperCase() : '';
  const typeLabel = ext || mimeType.split('/').pop()?.toUpperCase() || 'FILE';
  return `${typeLabel} · ${formatFileSize(size)}`;
}

interface SupportChatDocumentCardProps {
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  isOwn: boolean;
  onLayout?: () => void;
}

export function SupportChatDocumentCard({
  fileName,
  mimeType,
  size,
  url,
  isOwn,
  onLayout,
}: SupportChatDocumentCardProps) {
  useEffect(() => {
    onLayout?.();
  }, [onLayout]);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`support-chat__document-card${isOwn ? ' support-chat__document-card--own' : ''}`}
    >
      <span className="support-chat__document-icon" aria-hidden>
        <FileText size={22} strokeWidth={1.75} />
      </span>
      <span className="support-chat__document-meta">
        <span className="support-chat__document-name">{fileName}</span>
        <span className="support-chat__document-sub">{documentSubtitle(fileName, mimeType, size)}</span>
      </span>
    </a>
  );
}
