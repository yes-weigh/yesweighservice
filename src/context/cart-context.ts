import { createContext } from 'react';
import type { CatalogProduct } from '../types/catalog';
import type { CartItem } from '../types/cart';

export interface CartContextType {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  addItem: (product: CatalogProduct, quantity?: number) => boolean;
  removeItem: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  isInCart: (productId: string) => boolean;
  getQuantity: (productId: string) => number;
}

export const CartContext = createContext<CartContextType | undefined>(undefined);
