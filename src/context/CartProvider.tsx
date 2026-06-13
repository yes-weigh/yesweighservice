import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogProduct } from '../types/catalog';
import { cartItemFromProduct, type CartItem } from '../types/cart';
import { useAuth } from './AuthContext';
import { CartContext } from './cart-context';

const STORAGE_PREFIX = 'yesweigh-cart';

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}:${uid}`;
}

function readStoredCart(uid: string): CartItem[] {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartItem[];
    return Array.isArray(parsed) ? parsed.filter(item => item?.productId) : [];
  } catch {
    return [];
  }
}

function writeStoredCart(uid: string, items: CartItem[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(storageKey(uid));
    } else {
      localStorage.setItem(storageKey(uid), JSON.stringify(items));
    }
  } catch {
    /* ignore quota errors */
  }
}

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    if (user?.uid) {
      setItems(readStoredCart(user.uid));
    } else {
      setItems([]);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (user?.uid) {
      writeStoredCart(user.uid, items);
    }
  }, [items, user?.uid]);

  const addItem = useCallback((product: CatalogProduct, quantity = 1): boolean => {
    if (product.stockStatus === 'out_of_stock' || quantity < 1) return false;

    setItems(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id
            ? {
                ...item,
                rate: product.rate,
                stockStatus: product.stockStatus,
                name: product.name,
                quantity: item.quantity + quantity,
              }
            : item,
        );
      }
      return [...prev, cartItemFromProduct(product, quantity)];
    });
    return true;
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems(prev => prev.filter(item => item.productId !== productId));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity < 1) {
      setItems(prev => prev.filter(item => item.productId !== productId));
      return;
    }
    setItems(prev =>
      prev.map(item => (item.productId === productId ? { ...item, quantity } : item)),
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const isInCart = useCallback(
    (productId: string) => items.some(item => item.productId === productId),
    [items],
  );

  const getQuantity = useCallback(
    (productId: string) => items.find(item => item.productId === productId)?.quantity ?? 0,
    [items],
  );

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.rate * item.quantity, 0),
    [items],
  );

  const value = useMemo(
    () => ({
      items,
      itemCount,
      subtotal,
      addItem,
      removeItem,
      setQuantity,
      clearCart,
      isInCart,
      getQuantity,
    }),
    [items, itemCount, subtotal, addItem, removeItem, setQuantity, clearCart, isInCart, getQuantity],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
