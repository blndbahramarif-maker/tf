import { ProductListingPage } from "../components/shop/ProductListingPage";
import { getProductsByCategory } from "../data/products";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";

export default function Drinks() {
  usePageMeta(
    "Drinks",
    "Ice-cold fizzy drinks, still & sparkling water and energy drinks at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("drinks")!;
  const products = getProductsByCategory("drinks");
  return (
    <ProductListingPage
      category={category}
      products={products}
      heroTitle="Fresh, Ice-Cold Drinks"
      heroDescription="Fizzy drinks, still & sparkling water and energy drinks — always chilled and ready to grab."
    />
  );
}
