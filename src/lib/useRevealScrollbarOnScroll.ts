import { useEffect, useRef } from 'react';

const HIDE_DELAY_MS = 700;

/** Adds `is-scrolling` while the element is scrolled; removes it shortly after idle. */
export function useRevealScrollbarOnScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let hideTimer = 0;
    const onScroll = () => {
      el.classList.add('is-scrolling');
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        el.classList.remove('is-scrolling');
      }, HIDE_DELAY_MS);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.clearTimeout(hideTimer);
      el.classList.remove('is-scrolling');
    };
  }, []);

  return ref;
}
