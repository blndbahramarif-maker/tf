import { ProductListingPage } from "../components/shop/ProductListingPage";
import { getProductsByCategory } from "../data/products";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";

export default function Toys() {
  usePageMeta(
    "Kids' Toys",
    "Fun toys, educational toys and small gifts for children at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("toys")!;
  const products = getProductsByCategory("toys");
  return (
    <ProductListingPage
      category={category}
      products={products}
      heroTitle="Kids' Toys & Gifts"
      heroDescription="Bright, cheerful and fun — small toys, educational toys and lovely little gifts for children."
    />
  );
}
