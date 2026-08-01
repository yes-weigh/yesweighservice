import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { combinedCartRate, newCartLineId } from '../lib/gatcCart';
import { catalogProductIgnoresStockForCart } from '../lib/catalog';
import { effectiveCatalogStockStatus } from '../lib/sacCatalog';
import type { CatalogProduct } from '../types/catalog';
import {
  cartItemFromProduct,
  type AddCartItemOptions,
  type CartItem,
} from '../types/cart';
import { useAuth } from './AuthContext';
import { CartContext, type UpdateCartStampingInput } from './cart-context';

const STORAGE_PREFIX = 'yesweigh-cart';
/** Zoho SO notes max is 5000; keep a practical portal limit. */
export const CART_REMARKS_MAX_LENGTH = 2000;

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}:${uid}`;
}

function sameGatcKey(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a?.trim() || null) === (b?.trim() || null);
}

function normalizeCartItem(raw: Partial<CartItem> & { productId?: string }): CartItem | null {
  const productId = String(raw.productId ?? '').trim();
  if (!productId) return null;

  const baseRateRaw = raw.baseRate != null ? Number(raw.baseRate) : Number(raw.rate);
  const baseRate = Number.isFinite(baseRateRaw) ? Math.round(baseRateRaw * 100) / 100 : 0;
  const gatcStampingPriceId = String(raw.gatcStampingPriceId ?? '').trim() || null;
  const feeRaw = Number(raw.gatcFeePerUnit ?? 0);
  const gatcFeePerUnit = gatcStampingPriceId && Number.isFinite(feeRaw)
    ? Math.round(feeRaw * 100) / 100
    : 0;

  return {
    cartLineId: String(raw.cartLineId ?? '').trim() || newCartLineId(),
    productId,
    name: String(raw.name ?? 'Product'),
    sku: raw.sku != null ? String(raw.sku) : null,
    description: raw.description?.trim() || null,
    imageUrl: raw.imageUrl != null ? String(raw.imageUrl) : null,
    baseRate,
    gatcFeePerUnit,
    gatcStampingPriceId,
    gatcStampingRange: gatcStampingPriceId
      ? (raw.gatcStampingRange?.trim() || null)
      : null,
    rate: combinedCartRate(baseRate, gatcFeePerUnit),
    unit: String(raw.unit ?? 'pcs'),
    stockStatus: effectiveCatalogStockStatus(raw.stockStatus, raw.hsn),
    categoryName: raw.categoryName != null ? String(raw.categoryName) : null,
    categoryId: raw.categoryId != null ? String(raw.categoryId) : null,
    hsn: raw.hsn ?? null,
    quantity: Math.max(1, Math.floor(Number(raw.quantity) || 1)),
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
        items: parsed
          .map(item => normalizeCartItem(item))
          .filter((item): item is CartItem => Boolean(item)),
        remarks: '',
      };
    }
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return {
      items: items
        .map(item => normalizeCartItem(item))
        .filter((item): item is CartItem => Boolean(item)),
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

function parseAddOptions(options?: number | AddCartItemOptions): Required<
  Pick<AddCartItemOptions, 'quantity'>
> & AddCartItemOptions {
  if (typeof options === 'number') {
    return { quantity: options };
  }
  return {
    quantity: options?.quantity ?? 1,
    gatcStampingPriceId: options?.gatcStampingPriceId,
    gatcFeePerUnit: options?.gatcFeePerUnit,
    gatcStampingRange: options?.gatcStampingRange,
    insertAfterCartLineId: options?.insertAfterCartLineId,
  };
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

  const addItem = useCallback((
    product: CatalogProduct,
    options?: number | AddCartItemOptions,
  ): boolean => {
    const opts = parseAddOptions(options);
    const quantity = Math.floor(Number(opts.quantity) || 0);
    if (quantity < 1) return false;
    const stockStatus = effectiveCatalogStockStatus(product.stockStatus, product.hsn);
    if (
      !catalogProductIgnoresStockForCart(product)
      && stockStatus === 'out_of_stock'
    ) {
      return false;
    }

    const gatcStampingPriceId = opts.gatcStampingPriceId?.trim() || null;
    const gatcFeePerUnit = gatcStampingPriceId
      ? Math.round(Number(opts.gatcFeePerUnit ?? 0) * 100) / 100
      : 0;
    const baseRate = Math.round(Number(product.rate) * 100) / 100;

    setItems(prev => {
      const existing = prev.find(
        item => item.productId === product.id
          && sameGatcKey(item.gatcStampingPriceId, gatcStampingPriceId),
      );
      if (existing) {
        return prev.map(item =>
          item.cartLineId === existing.cartLineId
            ? {
                ...item,
                baseRate,
                gatcFeePerUnit,
                gatcStampingPriceId,
                gatcStampingRange: gatcStampingPriceId
                  ? (opts.gatcStampingRange?.trim() || item.gatcStampingRange || null)
                  : null,
                rate: combinedCartRate(baseRate, gatcFeePerUnit),
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
      const nextItem = cartItemFromProduct(product, quantity, {
        gatcStampingPriceId,
        gatcFeePerUnit,
        gatcStampingRange: opts.gatcStampingRange,
      });
      const afterId = String(opts.insertAfterCartLineId ?? '').trim();
      if (afterId) {
        const afterIndex = prev.findIndex(item => item.cartLineId === afterId);
        if (afterIndex >= 0) {
          const next = [...prev];
          next.splice(afterIndex + 1, 0, nextItem);
          return next;
        }
      }
      return [...prev, nextItem];
    });
    return true;
  }, []);

  const removeItem = useCallback((cartLineId: string) => {
    setItems(prev => prev.filter(item => item.cartLineId !== cartLineId));
  }, []);

  const setQuantity = useCallback((cartLineId: string, quantity: number) => {
    if (quantity < 1) {
      setItems(prev => prev.filter(item => item.cartLineId !== cartLineId));
      return;
    }
    setItems(prev =>
      prev.map(item => (item.cartLineId === cartLineId ? { ...item, quantity } : item)),
    );
  }, []);

  const updateStamping = useCallback((cartLineId: string, input: UpdateCartStampingInput) => {
    setItems(prev => {
      const target = prev.find(item => item.cartLineId === cartLineId);
      if (!target) return prev;

      const nextGatcId = input.withStamping
        ? (input.gatcStampingPriceId?.trim() || null)
        : null;
      if (input.withStamping && !nextGatcId) return prev;

      const nextFee = nextGatcId
        ? Math.round(Number(input.gatcFeePerUnit ?? 0) * 100) / 100
        : 0;
      const nextRange = nextGatcId
        ? (input.gatcStampingRange?.trim() || null)
        : null;

      // Merge into an existing row with the same product + stamping choice.
      const mergeInto = prev.find(
        item => item.cartLineId !== cartLineId
          && item.productId === target.productId
          && sameGatcKey(item.gatcStampingPriceId, nextGatcId),
      );

      if (mergeInto) {
        return prev
          .filter(item => item.cartLineId !== cartLineId)
          .map(item => (
            item.cartLineId === mergeInto.cartLineId
              ? {
                  ...item,
                  quantity: item.quantity + target.quantity,
                  baseRate: target.baseRate,
                  gatcFeePerUnit: nextFee,
                  gatcStampingPriceId: nextGatcId,
                  gatcStampingRange: nextRange,
                  rate: combinedCartRate(target.baseRate, nextFee),
                }
              : item
          ));
      }

      return prev.map(item => (
        item.cartLineId === cartLineId
          ? {
              ...item,
              gatcStampingPriceId: nextGatcId,
              gatcFeePerUnit: nextFee,
              gatcStampingRange: nextRange,
              rate: combinedCartRate(item.baseRate, nextFee),
            }
          : item
      ));
    });
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
    (productId: string) => items
      .filter(item => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0),
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
      updateStamping,
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
      updateStamping,
      setRemarks,
      clearCart,
      isInCart,
      getQuantity,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
