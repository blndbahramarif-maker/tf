import { Section, SectionHeading } from "../ui/Section";
import { CategoryCard } from "../shop/CategoryCard";
import { categories } from "../../data/categories";

export function CategoriesSection() {
  return (
    <Section className="bg-gradient-to-b from-white to-brand-50/40">
      <SectionHeading
        eyebrow="Shop by Category"
        title="Organised, Easy to Browse"
        description="Seven clearly organised categories so you can find exactly what you need, fast."
      />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {categories.map((c, i) => (
          <CategoryCard key={c.slug} category={c} index={i} />
        ))}
      </div>
    </Section>
  );
}
