import { ProductListingPage } from "../components/shop/ProductListingPage";
import { getProductsByCategory } from "../data/products";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";

export default function Phones() {
  usePageMeta(
    "Phones & Technology",
    "New, used and refurbished smartphones, tablets and iPads at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("phones")!;
  const products = getProductsByCategory("phones");
  return (
    <ProductListingPage
      category={category}
      products={products}
      heroTitle="Phones & Technology"
      heroDescription="Smartphones, tablets and iPads — new, used and refurbished. Every device is tested before it reaches you."
    />
  );
}
