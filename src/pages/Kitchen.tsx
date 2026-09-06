import { ProductListingPage } from "../components/shop/ProductListingPage";
import { useAllProducts, filterByCategory } from "../lib/useProducts";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";
import { PageLoader, PageError } from "../components/ui/PageState";

export default function Kitchen() {
  usePageMeta(
    "Kitchen & Home",
    "Cups, plates, bowls, cutlery and household essentials at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("kitchen")!;
  const { data, isLoading, isError, refetch } = useAllProducts();

  if (isLoading) return <PageLoader label="Loading kitchen & home..." />;
  if (isError || !data) return <PageError onRetry={() => refetch()} />;

  return (
    <ProductListingPage
      category={category}
      products={filterByCategory(data, "kitchen")}
      heroTitle="Kitchen & Home Essentials"
      heroDescription="Tableware, cutlery, kitchen accessories and everyday home essentials for your household."
    />
  );
}
