import { useState } from "react";
import { ShieldAlert, AlertTriangle, Ban, Info } from "lucide-react";
import { AgeGateModal } from "../components/vape/AgeGateModal";
import { ProductCard } from "../components/shop/ProductCard";
import { useAllProducts, filterByCategory } from "../lib/useProducts";
import { Section, SectionHeading } from "../components/ui/Section";
import { usePageMeta } from "../lib/usePageMeta";
import { PageLoader, PageError } from "../components/ui/PageState";

export default function Vape() {
  usePageMeta(
    "Vape Products (18+)",
    "Age-restricted vape products at DGN Tech Mobiles, Purley. Strictly for adult customers aged 18 and over."
  );
  const [verified, setVerified] = useState(false);
  const { data, isLoading, isError, refetch } = useAllProducts();
  const products = data ? filterByCategory(data, "vape") : [];

  return (
    <div>
      <AgeGateModal onVerified={() => setVerified(true)} />

      {verified && (
        <div>
          <div className="relative overflow-hidden bg-gradient-to-br from-slate-700 to-slate-900 py-14 text-white sm:py-20">
            <div className="bg-grid pointer-events-none absolute inset-0 opacity-20" />
            <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest">
                <ShieldAlert className="h-3.5 w-3.5" /> Age Restricted — 18+ Only
              </span>
              <h1 className="mt-4 max-w-2xl text-balance font-display text-3xl font-extrabold sm:text-4xl lg:text-5xl">
                Vape Products
              </h1>
              <p className="mt-4 max-w-xl text-balance text-white/75">
                For adult smokers looking to switch. Sold responsibly, strictly to customers aged 18 and over, in
                line with UK law.
              </p>
            </div>
          </div>

          <Section className="!pb-8">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <WarningCard
                icon={AlertTriangle}
                title="18+ Only"
                text="It is illegal to sell vape products to anyone under the age of 18. ID will be requested if you look under 25."
              />
              <WarningCard
                icon={Info}
                title="Contains Nicotine"
                text="Most e-liquids contain nicotine, which is an addictive substance. Not recommended for non-smokers."
              />
              <WarningCard
                icon={Ban}
                title="Not a Smoking Cessation Product"
                text="These products have not been approved as a way to quit smoking. Please seek medical advice if needed."
              />
            </div>
          </Section>

          <Section className="!pt-0">
            <SectionHeading
              eyebrow="Our Range"
              title="Vape Devices & E-Liquids"
              description="A straightforward, responsibly presented range for adult customers only."
            />
            {isLoading ? (
              <PageLoader label="Loading vape products..." />
            ) : isError ? (
              <PageError onRetry={() => refetch()} />
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
                {products.map((p, i) => (
                  <ProductCard key={p.id} product={p} index={i} />
                ))}
              </div>
            )}
          </Section>

          <Section className="bg-slate-100">
            <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-soft">
              <ShieldAlert className="mx-auto h-10 w-10 text-slate-500" />
              <h3 className="mt-4 font-display text-xl font-bold text-ink-950">Responsible Retailing</h3>
              <p className="mt-3 text-sm text-ink-950/60">
                DGN Tech Mobiles is committed to selling vape products responsibly. We do not sell to anyone under 18,
                we do not market these products to children, and this section is kept clearly separate from our toys
                and children's products. If you are trying to quit smoking, please speak to your GP or pharmacist for
                further advice and support.
              </p>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function WarningCard({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof AlertTriangle;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-700">
        <Icon className="h-5 w-5 text-white" />
      </span>
      <div>
        <p className="font-bold text-ink-950">{title}</p>
        <p className="mt-1 text-sm text-ink-950/60">{text}</p>
      </div>
    </div>
  );
}
