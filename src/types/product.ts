import type { IllustrationKey } from "../components/illustrations/Illustrations";
import type { CategorySlug } from "../data/categories";

export interface ProductColor {
  id: number;
  name: string;
  hex: string;
}

export interface ProductStorageOption {
  id: number;
  label: string;
  priceDelta: number;
  stock: number;
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  category: CategorySlug;
  subcategory: string;
  description: string;
  shortDescription: string;
  price: number;
  oldPrice?: number;
  brand?: string;
  condition?: "New" | "Used" | "Refurbished";
  badge?: string;
  icon?: IllustrationKey;
  featured: boolean;
  stock: number;
  images: string[];
  colors: ProductColor[];
  storageOptions: ProductStorageOption[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductInput {
  name: string;
  category: CategorySlug;
  subcategory: string;
  description: string;
  shortDescription: string;
  price: number;
  oldPrice?: number | null;
  brand?: string | null;
  condition?: "New" | "Used" | "Refurbished" | null;
  badge?: string | null;
  icon?: IllustrationKey | null;
  featured: boolean;
  stock: number;
  images: string[];
  colors: { name: string; hex: string }[];
  storageOptions: { label: string; priceDelta: number; stock: number }[];
}

export interface OrderItem {
  id: number;
  productId?: number;
  productName: string;
  color?: string;
  storage?: string;
  unitPrice: number;
  quantity: number;
}

export type OrderStatus = "pending" | "confirmed" | "ready" | "completed" | "cancelled";

export interface Order {
  id: number;
  orderNumber: string;
  customerName: string;
  phone: string;
  email: string;
  fulfilmentType: "collection" | "delivery";
  address?: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
  items: OrderItem[];
}

export function productTotalStock(product: Product): number {
  if (product.storageOptions.length > 0) {
    return product.storageOptions.reduce((sum, s) => sum + s.stock, 0);
  }
  return product.stock;
}
