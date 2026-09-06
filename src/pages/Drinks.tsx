import { ProductListingPage } from "../components/shop/ProductListingPage";
import { useAllProducts, filterByCategory } from "../lib/useProducts";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";
import { PageLoader, PageError } from "../components/ui/PageState";

export default function Drinks() {
  usePageMeta(
    "Drinks",
    "Ice-cold fizzy drinks, still & sparkling water and energy drinks at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("drinks")!;
  const { data, isLoading, isError, refetch } = useAllProducts();

  if (isLoading) return <PageLoader label="Loading drinks..." />;
  if (isError || !data) return <PageError onRetry={() => refetch()} />;

  return (
    <ProductListingPage
      category={category}
      products={filterByCategory(data, "drinks")}
      heroTitle="Fresh, Ice-Cold Drinks"
      heroDescription="Fizzy drinks, still & sparkling water and energy drinks — always chilled and ready to grab."
    />
  );
}
