import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { effectiveCatalogStockStatus } from '../lib/sacCatalog';
import type { CatalogProduct } from '../types/catalog';
import { cartItemFromProduct, type CartItem } from '../types/cart';
import { useAuth } from './AuthContext';
import { CartContext } from './cart-context';

const STORAGE_PREFIX = 'yesweigh-cart';
/** Zoho SO notes max is 5000; keep a practical portal limit. */
export const CART_REMARKS_MAX_LENGTH = 2000;

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}:${uid}`;
}

function normalizeCartItem(item: CartItem): CartItem {
  return {
    ...item,
    description: item.description?.trim() || null,
    stockStatus: effectiveCatalogStockStatus(item.stockStatus, item.hsn),
  };
}

function normalizeRemarks(raw: unknown): string {
  return String(raw ?? '').slice(0, CART_REMARKS_MAX_LENGTH);
}

interface StoredCart {
  items: CartItem[];
  remarks: string;
}

function readStoredCart(uid: string): StoredCart {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return { items: [], remarks: '' };
    const parsed = JSON.parse(raw) as CartItem[] | StoredCart;
    if (Array.isArray(parsed)) {
      return {
        items: parsed.filter(item => item?.productId).map(normalizeCartItem),
        remarks: '',
      };
    }
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return {
      items: items.filter(item => item?.productId).map(normalizeCartItem),
      remarks: normalizeRemarks(parsed?.remarks),
    };
  } catch {
    return { items: [], remarks: '' };
  }
}

function writeStoredCart(uid: string, items: CartItem[], remarks: string): void {
  try {
    if (items.length === 0 && !remarks.trim()) {
      localStorage.removeItem(storageKey(uid));
    } else {
      const payload: StoredCart = { items, remarks: normalizeRemarks(remarks) };
      localStorage.setItem(storageKey(uid), JSON.stringify(payload));
    }
  } catch {
    /* ignore quota errors */
  }
}

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [remarks, setRemarksState] = useState('');

  useEffect(() => {
    if (user?.uid) {
      const stored = readStoredCart(user.uid);
      setItems(stored.items);
      setRemarksState(stored.remarks);
    } else {
      setItems([]);
      setRemarksState('');
    }
  }, [user?.uid]);

  useEffect(() => {
    if (user?.uid) {
      writeStoredCart(user.uid, items, remarks);
    }
  }, [items, remarks, user?.uid]);

  const addItem = useCallback((product: CatalogProduct, quantity = 1): boolean => {
    const stockStatus = effectiveCatalogStockStatus(product.stockStatus, product.hsn);
    if (stockStatus === 'out_of_stock' || quantity < 1) return false;

    setItems(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id
            ? {
                ...item,
                rate: product.rate,
                stockStatus,
                hsn: product.hsn ?? item.hsn ?? null,
                name: product.name,
                description: product.description?.trim() || item.description || null,
                sku: product.sku ?? item.sku,
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

  const setRemarks = useCallback((next: string) => {
    setRemarksState(normalizeRemarks(next));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setRemarksState('');
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
      remarks,
      addItem,
      removeItem,
      setQuantity,
      setRemarks,
      clearCart,
      isInCart,
      getQuantity,
    }),
    [
      items,
      itemCount,
      subtotal,
      remarks,
      addItem,
      removeItem,
      setQuantity,
      setRemarks,
      clearCart,
      isInCart,
      getQuantity,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
