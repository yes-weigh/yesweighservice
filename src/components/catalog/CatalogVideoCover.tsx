import { useEffect, useRef } from 'react';
import { Play } from 'lucide-react';

export function CatalogVideoCover({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const snapFrame = () => {
      if (el.currentTime > 0.02) return;
      try {
        const duration = Number.isFinite(el.duration) ? el.duration : 0;
        el.currentTime = duration > 0.3 ? 0.15 : 0.01;
      } catch {
        // best-effort cover frame
      }
    };
    el.addEventListener('loadeddata', snapFrame);
    el.addEventListener('loadedmetadata', snapFrame);
    return () => {
      el.removeEventListener('loadeddata', snapFrame);
      el.removeEventListener('loadedmetadata', snapFrame);
    };
  }, [src]);

  return (
    <video
      ref={ref}
      className={['catalog-video-cover', className].filter(Boolean).join(' ')}
      src={src}
      muted
      playsInline
      preload="metadata"
      aria-hidden
    />
  );
}

export function CatalogVideoPlayer({
  src,
  playing,
  onPlay,
}: {
  src: string;
  playing: boolean;
  onPlay: () => void;
}) {
  return (
    <div className="catalog-video-player">
      {playing ? (
        <video
          className="catalog-video-player__video"
          src={src}
          controls
          autoPlay
          playsInline
          controlsList="nodownload noplaybackrate noremoteplayback"
          disablePictureInPicture
        />
      ) : (
        <>
          <CatalogVideoCover src={src} className="catalog-video-player__cover" />
          <button
            type="button"
            className="catalog-video-player__play"
            onClick={onPlay}
            aria-label="Play video"
          >
            <Play size={28} strokeWidth={2.2} fill="currentColor" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
