import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import type { Category } from "../../data/categories";
import { ILLUSTRATIONS } from "../illustrations/Illustrations";
import { TiltCard } from "../ui/TiltCard";

export function CategoryCard({ category, index = 0 }: { category: Category; index?: number }) {
  const Illustration = ILLUSTRATIONS[category.icon];
  return (
    <TiltCard className="h-full animate-fade-up" style={{ animationDelay: `${index * 70}ms` }}>
      <Link
        to={category.href}
        className="card-hover group relative flex h-full flex-col overflow-hidden rounded-3xl border border-ink-950/5 bg-white shadow-soft"
      >
        <div className={`relative flex h-40 items-center justify-center overflow-hidden bg-gradient-to-br ${category.gradient}`}>
          <div className="absolute -right-6 -top-6 h-28 w-28 animate-blob bg-white/10" />
          <div className="absolute -bottom-8 -left-8 h-24 w-24 animate-blob bg-white/10" style={{ animationDelay: "2s" }} />
          <Illustration className="h-28 w-28 drop-shadow-2xl transition-transform duration-500 group-hover:scale-110" />
          {category.ageRestricted && (
            <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
              <ShieldAlert className="h-3.5 w-3.5" /> 18+
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-5">
          <span className={`text-xs font-bold uppercase tracking-wide ${category.textAccent}`}>{category.tagline}</span>
          <h3 className="font-display text-lg font-bold text-ink-950">{category.name}</h3>
          <p className="text-sm text-ink-950/60">{category.blurb}</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-ink-950 transition-colors group-hover:text-brand-600">
            Shop now <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </div>
      </Link>
    </TiltCard>
  );
}
