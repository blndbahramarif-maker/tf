import { ProductListingPage } from "../components/shop/ProductListingPage";
import { getProductsByCategory } from "../data/products";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";

export default function Accessories() {
  usePageMeta(
    "Phone Accessories",
    "Cases, chargers, cables, screen protectors, headphones, earbuds and power banks at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("accessories")!;
  const products = getProductsByCategory("accessories");
  return (
    <ProductListingPage
      category={category}
      products={products}
      heroTitle="Phone Accessories"
      heroDescription="Everything to protect, charge and power your devices — cases, chargers, cables, screen protectors, headphones and more."
    />
  );
}
