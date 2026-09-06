import { ProductListingPage } from "../components/shop/ProductListingPage";
import { useAllProducts, filterByCategory } from "../lib/useProducts";
import { getCategory } from "../data/categories";
import { usePageMeta } from "../lib/usePageMeta";
import { PageLoader, PageError } from "../components/ui/PageState";

export default function Toys() {
  usePageMeta(
    "Kids' Toys",
    "Fun toys, educational toys and small gifts for children at DGN Tech Mobiles, Purley."
  );
  const category = getCategory("toys")!;
  const { data, isLoading, isError, refetch } = useAllProducts();

  if (isLoading) return <PageLoader label="Loading toys..." />;
  if (isError || !data) return <PageError onRetry={() => refetch()} />;

  return (
    <ProductListingPage
      category={category}
      products={filterByCategory(data, "toys")}
      heroTitle="Kids' Toys & Gifts"
      heroDescription="Bright, cheerful and fun — small toys, educational toys and lovely little gifts for children."
    />
  );
}
