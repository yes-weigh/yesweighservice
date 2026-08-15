import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Shrink font until the text fits on one line in the available width. */
export function FitSingleLine({
  children,
  className,
  minPx = 8,
}: {
  children: ReactNode;
  className?: string;
  minPx?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(base) || base <= 0) return;
      let size = base;
      el.style.fontSize = `${size}px`;
      let steps = 28;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > minPx && steps > 0) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
        steps -= 1;
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [children, minPx]);

  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
}
