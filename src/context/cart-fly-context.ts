import { createContext } from 'react';

export interface CartFlyOptions {
  imageUrl?: string | null;
}

export interface CartFlyContextType {
  flyToCart: (source: HTMLElement, options?: CartFlyOptions) => void;
  registerCartTarget: (element: HTMLElement | null) => void;
  cartBump: boolean;
}

export const CartFlyContext = createContext<CartFlyContextType | undefined>(undefined);
