import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart } from 'lucide-react';
import { CartFlyContext, type CartFlyOptions } from './cart-fly-context';

const PORTAL_ID = 'cart-fly-portal';

interface FlyParticle {
  id: string;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  imageUrl?: string | null;
}

function getPortalNode(): HTMLElement {
  let el = document.getElementById(PORTAL_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PORTAL_ID;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

function CartFlyParticle({
  particle,
  onComplete,
}: {
  particle: FlyParticle;
  onComplete: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);
  const { sx, sy, ex, ey } = particle;

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete(particle.id);
  }, [onComplete, particle.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      finish();
      return;
    }

    const midX = (sx + ex) / 2;
    const arcY = Math.min(sy, ey) - Math.max(96, Math.abs(ex - sx) * 0.18);

    let animation: Animation | null = null;
    let frame = 0;

    const startAnimation = () => {
      animation = el.animate(
        [
          {
            transform: `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -50%) scale(1)`,
            opacity: 1,
          },
          {
            transform: `translate3d(${midX}px, ${arcY}px, 0) translate(-50%, -50%) scale(0.9)`,
            opacity: 1,
            offset: 0.5,
          },
          {
            transform: `translate3d(${ex}px, ${ey}px, 0) translate(-50%, -50%) scale(0.25)`,
            opacity: 0.9,
          },
        ],
        {
          duration: 780,
          easing: 'cubic-bezier(0.22, 0.85, 0.25, 1)',
          fill: 'forwards',
        },
      );

      animation.onfinish = () => finish();
    };

    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(startAnimation);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (animation) {
        animation.onfinish = null;
        animation.cancel();
      }
    };
  }, [sx, sy, ex, ey, finish]);

  return (
    <div
      ref={ref}
      className="cart-fly-particle"
      style={{
        transform: `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -50%) scale(1)`,
      }}
      aria-hidden
    >
      {particle.imageUrl ? (
        <img src={particle.imageUrl} alt="" className="cart-fly-particle__img" draggable={false} />
      ) : (
        <span className="cart-fly-particle__icon">
          <ShoppingCart size={22} strokeWidth={2.5} />
        </span>
      )}
    </div>
  );
}

export const CartFlyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const targetRef = useRef<HTMLElement | null>(null);
  const [particles, setParticles] = useState<FlyParticle[]>([]);
  const [cartBump, setCartBump] = useState(false);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const bumpTimer = useRef<number | null>(null);

  useEffect(() => {
    setPortalNode(getPortalNode());
  }, []);

  const registerCartTarget = useCallback((element: HTMLElement | null) => {
    targetRef.current = element;
  }, []);

  const triggerBump = useCallback(() => {
    setCartBump(true);
    if (bumpTimer.current) window.clearTimeout(bumpTimer.current);
    bumpTimer.current = window.setTimeout(() => {
      setCartBump(false);
      bumpTimer.current = null;
    }, 520);
  }, []);

  const flyToCart = useCallback((source: HTMLElement, options?: CartFlyOptions) => {
    const target =
      targetRef.current ?? document.getElementById('cart-fly-target');

    if (!target) return;

    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    setParticles(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        sx: sourceRect.left + sourceRect.width / 2,
        sy: sourceRect.top + sourceRect.height / 2,
        ex: targetRect.left + targetRect.width / 2,
        ey: targetRect.top + targetRect.height / 2,
        imageUrl: options?.imageUrl,
      },
    ]);
  }, []);

  const handleParticleComplete = useCallback(
    (id: string) => {
      setParticles(prev => prev.filter(p => p.id !== id));
      triggerBump();
    },
    [triggerBump],
  );

  useEffect(
    () => () => {
      if (bumpTimer.current) window.clearTimeout(bumpTimer.current);
    },
    [],
  );

  const value = React.useMemo(
    () => ({ flyToCart, registerCartTarget, cartBump }),
    [flyToCart, registerCartTarget, cartBump],
  );

  return (
    <CartFlyContext.Provider value={value}>
      {children}
      {portalNode &&
        createPortal(
          <>
            {particles.map(particle => (
              <CartFlyParticle
                key={particle.id}
                particle={particle}
                onComplete={handleParticleComplete}
              />
            ))}
          </>,
          portalNode,
        )}
    </CartFlyContext.Provider>
  );
};
