import { ProductListingPage } from "../components/shop/ProductListingPage";
import { useAllProducts, filterByCategory } from "../lib/useProducts";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";
import { PageLoader, PageError } from "../components/ui/PageState";

export default function Phones() {
  usePageMeta(
    "Phones & Technology",
    "New, used and refurbished smartphones, tablets and iPads at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("phones")!;
  const { data, isLoading, isError, refetch } = useAllProducts();

  if (isLoading) return <PageLoader label="Loading phones..." />;
  if (isError || !data) return <PageError onRetry={() => refetch()} />;

  return (
    <ProductListingPage
      category={category}
      products={filterByCategory(data, "phones")}
      heroTitle="Phones & Technology"
      heroDescription="Smartphones, tablets and iPads — new, used and refurbished. Every device is tested before it reaches you."
    />
  );
}
