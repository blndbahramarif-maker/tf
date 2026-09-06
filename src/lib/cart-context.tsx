import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { Product } from "../types/product";

export interface CartSelection {
  color?: string;
  storage?: string;
}

export interface CartItem {
  key: string;
  productId: number;
  name: string;
  slug: string;
  image?: string;
  icon?: Product["icon"];
  category: Product["category"];
  color?: string;
  storage?: string;
  unitPrice: number;
  quantity: number;
  maxStock: number;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
}

type CartAction =
  | { type: "ADD"; product: Product; quantity: number; selection: CartSelection }
  | { type: "REMOVE"; key: string }
  | { type: "SET_QTY"; key: string; quantity: number }
  | { type: "CLEAR" }
  | { type: "OPEN" }
  | { type: "CLOSE" };

const STORAGE_KEY = "dgn-cart-v2";

function cartKey(productId: number, selection: CartSelection) {
  return `${productId}::${selection.color ?? ""}::${selection.storage ?? ""}`;
}

function priceFor(product: Product, selection: CartSelection) {
  if (selection.storage && product.storageOptions.length > 0) {
    const option = product.storageOptions.find((o) => o.label === selection.storage);
    if (option) return product.price + option.priceDelta;
  }
  return product.price;
}

function stockFor(product: Product, selection: CartSelection) {
  if (product.storageOptions.length > 0) {
    const option = product.storageOptions.find((o) => o.label === selection.storage);
    return option ? option.stock : 0;
  }
  return product.stock;
}

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD": {
      const key = cartKey(action.product.id, action.selection);
      const maxStock = stockFor(action.product, action.selection);
      const existing = state.items.find((i) => i.key === key);
      const items = existing
        ? state.items.map((i) =>
            i.key === key
              ? { ...i, quantity: Math.min(maxStock, i.quantity + action.quantity) }
              : i
          )
        : [
            ...state.items,
            {
              key,
              productId: action.product.id,
              name: action.product.name,
              slug: action.product.slug,
              image: action.product.images[0],
              icon: action.product.icon,
              category: action.product.category,
              color: action.selection.color,
              storage: action.selection.storage,
              unitPrice: priceFor(action.product, action.selection),
              quantity: Math.min(maxStock, action.quantity),
              maxStock,
            },
          ];
      return { ...state, items, isOpen: true };
    }
    case "REMOVE":
      return { ...state, items: state.items.filter((i) => i.key !== action.key) };
    case "SET_QTY":
      return {
        ...state,
        items: state.items
          .map((i) =>
            i.key === action.key
              ? { ...i, quantity: Math.max(1, Math.min(i.maxStock, action.quantity)) }
              : i
          )
          .filter((i) => i.quantity > 0),
      };
    case "CLEAR":
      return { ...state, items: [] };
    case "OPEN":
      return { ...state, isOpen: true };
    case "CLOSE":
      return { ...state, isOpen: false };
    default:
      return state;
  }
}

interface CartContextValue {
  items: CartItem[];
  isOpen: boolean;
  addItem: (product: Product, quantity?: number, selection?: CartSelection) => void;
  removeItem: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
  count: number;
  subtotal: number;
}

const CartContext = createContext<CartContextValue | null>(null);

function loadInitialState(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { items: JSON.parse(raw), isOpen: false };
  } catch {
    /* ignore corrupt storage */
  }
  return { items: [], isOpen: false };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
    } catch {
      /* storage unavailable */
    }
  }, [state.items]);

  const value = useMemo<CartContextValue>(() => {
    const count = state.items.reduce((sum, i) => sum + i.quantity, 0);
    const subtotal = state.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    return {
      items: state.items,
      isOpen: state.isOpen,
      addItem: (product, quantity = 1, selection = {}) =>
        dispatch({ type: "ADD", product, quantity, selection }),
      removeItem: (key) => dispatch({ type: "REMOVE", key }),
      setQuantity: (key, quantity) => dispatch({ type: "SET_QTY", key, quantity }),
      clear: () => dispatch({ type: "CLEAR" }),
      open: () => dispatch({ type: "OPEN" }),
      close: () => dispatch({ type: "CLOSE" }),
      count,
      subtotal,
    };
  }, [state]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
