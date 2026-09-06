import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Section, SectionHeading } from "../ui/Section";
import { ProductCard } from "../shop/ProductCard";
import { useAllProducts } from "../../lib/useProducts";
import { PageLoader, PageError } from "../ui/PageState";

export function FeaturedProducts() {
  const { data, isLoading, isError, refetch } = useAllProducts();
  const featured = (data ?? []).filter((p) => p.featured).slice(0, 8);

  return (
    <Section>
      <SectionHeading
        eyebrow="Popular Picks"
        title="Customer Favourites"
        description="A mix of our best-selling phones, accessories and everyday essentials."
      />
      {isLoading ? (
        <PageLoader label="Loading favourites..." />
      ) : isError ? (
        <PageError onRetry={() => refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {featured.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      )}
      <div className="mt-10 text-center">
        <Link to="/shop" className="inline-flex items-center gap-2 rounded-full border-2 border-brand-200 px-6 py-3 text-sm font-bold text-brand-700 hover:bg-brand-50">
          View All Products <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </Section>
  );
}
