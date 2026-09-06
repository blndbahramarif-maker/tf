import { ILLUSTRATIONS, type IllustrationKey } from "../components/illustrations/Illustrations";
import { getCategory } from "../data/categories";
import type { Product } from "../types/product";

export function resolveIllustrationKey(
  product: Pick<Product, "icon" | "category">
): IllustrationKey {
  if (product.icon && product.icon in ILLUSTRATIONS) {
    return product.icon as IllustrationKey;
  }
  return getCategory(product.category)?.icon ?? "phone";
}

export function defaultSelection(product: Product) {
  return {
    color: product.colors[0]?.name,
    storage: product.storageOptions[0]?.label,
  };
}
