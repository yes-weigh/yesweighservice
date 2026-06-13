import React, { useEffect, useRef, useState } from 'react';

const WHITE_THRESHOLD = 232;
const WHITE_SOFTNESS = 28;

function knockOutWhiteBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);

    if (min >= WHITE_THRESHOLD) {
      data[i + 3] = 0;
      continue;
    }

    if (max >= WHITE_THRESHOLD && max - min < 24) {
      const fade = Math.min(1, (max - WHITE_THRESHOLD) / WHITE_SOFTNESS);
      data[i + 3] = Math.round(data[i + 3]! * (1 - fade));
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

interface CategoryThumbnailProps {
  src: string;
  className?: string;
}

export const CategoryThumbnail: React.FC<CategoryThumbnailProps> = ({
  src,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUseFallback(false);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const maxEdge = 160;
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setUseFallback(true);
        return;
      }

      try {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        knockOutWhiteBackground(ctx, width, height);
      } catch {
        setUseFallback(true);
      }
    };

    img.onerror = () => {
      if (!cancelled) setUseFallback(true);
    };

    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (useFallback) {
    return (
      <img
        src={src}
        alt=""
        className={`catalog-category-card__img catalog-category-card__img--blend ${className}`.trim()}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={`catalog-category-card__img ${className}`.trim()}
      aria-hidden
    />
  );
};
