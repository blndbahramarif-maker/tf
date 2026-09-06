import { useQuery } from "@tanstack/react-query";
import { fetchProductBySlug, fetchProducts } from "./api";
import type { CategorySlug } from "../data/categories";
import type { Product } from "../types/product";

export const PRODUCTS_QUERY_KEY = ["products"] as const;

export function useAllProducts() {
  return useQuery({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn: fetchProducts,
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ["product", slug],
    queryFn: () => fetchProductBySlug(slug as string),
    enabled: !!slug,
  });
}

export function filterByCategory(products: Product[], category: CategorySlug) {
  return products.filter((p) => p.category === category);
}

export function searchProductList(products: Product[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.subcategory.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q)
  );
}
