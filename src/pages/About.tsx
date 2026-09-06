import { Smartphone, Wrench, ShoppingBag, Heart } from "lucide-react";
import { Section, SectionHeading } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { PhoneIllustration, ToolsIllustration, GiftIllustration, ColaCanIllustration } from "../components/illustrations/Illustrations";
import { usePageMeta } from "../lib/usePageMeta";

const pillars = [
  { icon: Smartphone, title: "Phone Sales", text: "Buying, selling, new, used and refurbished smartphones and tablets." },
  { icon: Wrench, title: "Expert Repairs", text: "Phone, iPad, tablet and TV repairs with same-day and next-day options." },
  { icon: ShoppingBag, title: "Everyday Essentials", text: "Accessories, drinks, kitchen products and children's toys, all in one shop." },
  { icon: Heart, title: "Friendly Service", text: "Honest advice and a warm welcome from a genuinely local, family-feel shop." },
];

export default function About() {
  usePageMeta(
    "About Us",
    "DGN Tech Mobiles is a local shop in Purley offering phone sales, repairs, accessories, drinks, kitchen products and toys."
  );
  return (
    <div>
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-ink-950 to-brand-800 py-16 text-white sm:py-24">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest">
            About DGN Tech Mobiles
          </span>
          <h1 className="mt-5 text-balance font-display text-4xl font-extrabold sm:text-5xl">
            Your Local Shop for Technology, Repairs &amp; Everyday Essentials.
          </h1>
        </div>
      </div>

      <Section>
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div className="animate-fade-up">
            <SectionHeading align="left" eyebrow="Our Story" title="A Genuine Local Shop in Purley" />
            <div className="-mt-6 space-y-4 text-ink-950/70">
              <p>
                DGN Tech Mobiles is a local shop based on Russell Hill Road in Purley, proudly serving the community
                with a genuinely wide range of products and services under one roof.
              </p>
              <p>
                We specialise in buying and selling mobile phones — new, used and refurbished — along with expert
                phone, iPad, tablet and TV repairs, often available same-day or next-day. Alongside our technology
                services, we stock phone accessories, chargers, cases, headphones and power banks for every device.
              </p>
              <p>
                We're also your handy neighbourhood stop for cold drinks, kitchen and household essentials, and fun
                toys and gifts for children — because a great local shop should have a little bit of everything.
              </p>
              <p className="font-display text-lg font-bold text-ink-950">
                "Your local shop for technology, repairs and everyday essentials."
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button to="/shop" variant="primary">Browse the Shop</Button>
              <Button to="/contact" variant="ghost">Get in Touch</Button>
            </div>
          </div>
          <div className="relative mx-auto grid h-80 w-full max-w-md grid-cols-2 gap-4">
            <div className="flex items-center justify-center rounded-3xl bg-brand-50 p-6 animate-float">
              <PhoneIllustration className="h-full w-full" />
            </div>
            <div className="flex items-center justify-center rounded-3xl bg-rose-50 p-6 animate-float-slow" style={{ animationDelay: "0.4s" }}>
              <ToolsIllustration className="h-full w-full" />
            </div>
            <div className="flex items-center justify-center rounded-3xl bg-teal-50 p-6 animate-float-slow" style={{ animationDelay: "0.8s" }}>
              <ColaCanIllustration className="h-full w-full" />
            </div>
            <div className="flex items-center justify-center rounded-3xl bg-pink-50 p-6 animate-float" style={{ animationDelay: "1.2s" }}>
              <GiftIllustration className="h-full w-full" />
            </div>
          </div>
        </div>
      </Section>

      <Section className="bg-gradient-to-b from-white to-brand-50/40">
        <SectionHeading eyebrow="What We Do" title="Four Ways We Help Our Customers" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p, i) => (
            <div key={p.title} className="animate-fade-up card-hover rounded-3xl border border-ink-950/5 bg-white p-7 text-center shadow-soft" style={{ animationDelay: `${i * 80}ms` }}>
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700">
                <p.icon className="h-7 w-7 text-white" />
              </span>
              <h3 className="mt-4 font-display text-lg font-bold text-ink-950">{p.title}</h3>
              <p className="mt-2 text-sm text-ink-950/60">{p.text}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
