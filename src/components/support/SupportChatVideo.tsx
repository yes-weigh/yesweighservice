import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

interface SupportChatVideoProps {
  src: string;
  className?: string;
  fileName?: string;
}

export const SupportChatVideo: React.FC<SupportChatVideoProps> = ({
  src,
  className,
  fileName,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPoster(null);
    setReady(false);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const capturePoster = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        setPoster(dataUrl);
      } catch {
        // Canvas may be tainted without CORS — video still plays.
      } finally {
        setReady(true);
      }
    };

    const onLoadedMetadata = () => {
      if (video.duration > 0.15) {
        video.currentTime = 0.1;
        return;
      }
      capturePoster();
    };

    const onSeeked = () => {
      capturePoster();
    };

    const onLoadedData = () => {
      if (!poster) capturePoster();
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoadedData);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoadedData);
    };
  }, [src, poster]);

  return (
    <div className="support-chat__video-wrap">
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        controls
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        className={className}
      />
      {!ready && !poster && (
        <span className="support-chat__video-placeholder" aria-hidden>
          <Play size={28} />
        </span>
      )}
      {fileName && <span className="support-chat__attachment-name">{fileName}</span>}
    </div>
  );
};
