import type { ReactNode } from "react";

export function Section({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`relative py-16 md:py-24 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-brand-700 ${className}`}
    >
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  light = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  light?: boolean;
}) {
  return (
    <div
      className={`mx-auto mb-12 max-w-3xl animate-fade-up ${
        align === "center" ? "text-center" : "text-left mx-0"
      }`}
    >
      {eyebrow && <Eyebrow className={light ? "border-white/20 bg-white/10 text-white" : ""}>{eyebrow}</Eyebrow>}
      <h2
        className={`mt-4 text-balance font-display text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl ${
          light ? "text-white" : "text-ink-950"
        }`}
      >
        {title}
      </h2>
      {description && (
        <p className={`mt-4 text-lg ${light ? "text-white/75" : "text-ink-950/60"}`}>{description}</p>
      )}
    </div>
  );
}
