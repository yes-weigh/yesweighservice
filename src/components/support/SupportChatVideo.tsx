import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

interface SupportChatVideoProps {
  src: string;
  mimeType?: string;
  posterUrl?: string | null;
  className?: string;
  fileName?: string;
  onLayout?: () => void;
}

export const SupportChatVideo: React.FC<SupportChatVideoProps> = ({
  src,
  mimeType,
  posterUrl,
  className,
  fileName,
  onLayout,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    setStatus('loading');
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const markReady = () => {
      setStatus(current => (current === 'error' ? current : 'ready'));
      onLayout?.();
    };

    const onLoadedMetadata = () => markReady();
    const onCanPlay = () => markReady();
    const onError = () => setStatus('error');

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
    };
  }, [src, onLayout]);

  const type = mimeType?.split(';')[0].trim() || undefined;

  return (
    <div className="support-chat__video-wrap">
      <video
        ref={videoRef}
        src={src}
        poster={posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        className={className}
        {...(type ? { 'data-mime-type': type } : {})}
      />

      {status === 'loading' && !posterUrl && (
        <span className="support-chat__video-placeholder" aria-hidden>
          <Play size={28} />
        </span>
      )}

      {status === 'error' && (
        <a
          className="support-chat__video-fallback"
          href={src}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open video
        </a>
      )}

      {fileName && <span className="support-chat__attachment-name">{fileName}</span>}
    </div>
  );
};
