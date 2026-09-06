import { ProductListingPage } from "../components/shop/ProductListingPage";
import { getProductsByCategory } from "../data/products";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";

export default function Kitchen() {
  usePageMeta(
    "Kitchen & Home",
    "Cups, plates, bowls, cutlery and household essentials at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("kitchen")!;
  const products = getProductsByCategory("kitchen");
  return (
    <ProductListingPage
      category={category}
      products={products}
      heroTitle="Kitchen & Home Essentials"
      heroDescription="Tableware, cutlery, kitchen accessories and everyday home essentials for your household."
    />
  );
}
