import React, { useEffect, useRef, useState } from 'react';
import {
  loadFastImage,
  peekFastImageUrl,
  type FastImageSize,
} from '../../lib/fastImageCache';

type FastRemoteImageProps = {
  src: string;
  alt?: string;
  className?: string;
  /** Decode immediately — first screen of a grid / hero photo. */
  priority?: boolean;
  size?: FastImageSize;
};

const nearWatchers = new Map<Element, () => void>();
let nearObserver: IntersectionObserver | null = null;

function getNearObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!nearObserver) {
    nearObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const notify = nearWatchers.get(entry.target);
        if (!notify) continue;
        notify();
        nearObserver?.unobserve(entry.target);
        nearWatchers.delete(entry.target);
      }
    }, { rootMargin: '520px 0px', threshold: 0.01 });
  }
  return nearObserver;
}

function watchNearViewport(element: Element, onNear: () => void): () => void {
  const observer = getNearObserver();
  if (!observer) {
    onNear();
    return () => undefined;
  }
  nearWatchers.set(element, onNear);
  observer.observe(element);
  return () => {
    observer.unobserve(element);
    nearWatchers.delete(element);
  };
}

/**
 * Marketplace-style remote image: viewport gate, tiny display copies in
 * IndexedDB, and a shared download queue so phone radios are not flooded.
 */
export const FastRemoteImage: React.FC<FastRemoteImageProps> = ({
  src,
  alt = '',
  className = '',
  priority = false,
  size = 'thumb',
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cached = peekFastImageUrl(src, size);
  const [displaySrc, setDisplaySrc] = useState<string | null>(cached);
  const [fromCache, setFromCache] = useState(Boolean(cached));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cachedSrc = peekFastImageUrl(src, size);
    setDisplaySrc(cachedSrc);
    setFromCache(Boolean(cachedSrc));
    setFailed(false);

    if (!src) return;
    if (cachedSrc) return;

    let cancelled = false;
    let stopWatch: (() => void) | undefined;

    const start = () => {
      void loadFastImage(src, size, priority)
        .then(url => {
          if (!cancelled) {
            setDisplaySrc(url);
            setFromCache(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDisplaySrc(src);
            setFromCache(false);
            setFailed(false);
          }
        });
    };

    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (priority) {
        start();
        return;
      }
      const node = imgRef.current;
      const target = node && node.getBoundingClientRect().height >= 2
        ? node
        : node?.parentElement ?? node;
      if (!target) {
        start();
        return;
      }
      stopWatch = watchNearViewport(target, start);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      stopWatch?.();
    };
  }, [priority, size, src]);

  const ready = Boolean(displaySrc);
  const classes = [
    className,
    'fast-remote-image',
    ready ? 'fast-remote-image--ready' : 'fast-remote-image--pending',
    ready && fromCache ? 'fast-remote-image--cached' : '',
    ready && !fromCache ? 'fast-remote-image--network' : '',
  ].filter(Boolean).join(' ');

  return (
    <img
      ref={imgRef}
      src={displaySrc ?? undefined}
      alt={alt}
      className={classes}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'low'}
      onError={() => {
        if (failed || !src) return;
        setFailed(true);
        setDisplaySrc(src);
        setFromCache(false);
      }}
    />
  );
};
