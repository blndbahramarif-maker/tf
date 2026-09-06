import { ProductListingPage } from "../components/shop/ProductListingPage";
import { useAllProducts, filterByCategory } from "../lib/useProducts";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";
import { PageLoader, PageError } from "../components/ui/PageState";

export default function Accessories() {
  usePageMeta(
    "Phone Accessories",
    "Cases, chargers, cables, screen protectors, headphones, earbuds and power banks at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("accessories")!;
  const { data, isLoading, isError, refetch } = useAllProducts();

  if (isLoading) return <PageLoader label="Loading accessories..." />;
  if (isError || !data) return <PageError onRetry={() => refetch()} />;

  return (
    <ProductListingPage
      category={category}
      products={filterByCategory(data, "accessories")}
      heroTitle="Phone Accessories"
      heroDescription="Everything to protect, charge and power your devices — cases, chargers, cables, screen protectors, headphones and more."
    />
  );
}
