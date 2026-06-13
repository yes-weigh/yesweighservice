import { useContext } from 'react';
import { CartFlyContext } from './cart-fly-context';

export function useCartFly() {
  const ctx = useContext(CartFlyContext);
  if (!ctx) throw new Error('useCartFly must be used within CartFlyProvider');
  return ctx;
}
