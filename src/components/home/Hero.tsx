import { ArrowRight, Wrench, MessageCircle, Star, ShieldCheck, Zap } from "lucide-react";
import { Button } from "../ui/Button";
import { Hero3DGate } from "../three/Hero3DGate";

export function Hero() {
  return (
    <section className="grain relative overflow-hidden bg-gradient-to-b from-ink-950 via-brand-950 to-brand-900 pb-24 pt-14 text-white sm:pb-32 sm:pt-20">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[820px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-brand-500/20 blur-[120px]" />
      <div className="pointer-events-none absolute -left-32 top-10 h-72 w-72 animate-blob rounded-full bg-brand-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 animate-blob rounded-full bg-accent-500/20 blur-3xl" style={{ animationDelay: "3s" }} />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-brand-200 backdrop-blur">
            <Star className="h-3.5 w-3.5 fill-accent-400 text-accent-400" /> Purley's Local Tech &amp; Everyday Shop
          </span>
          <h1 className="mt-6 text-balance font-display text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-5xl lg:text-7xl">
            DGN Tech{" "}
            <span className="bg-gradient-to-r from-brand-300 via-accent-300 to-teal-300 bg-clip-text text-transparent">
              Mobiles
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-balance font-display text-xl font-semibold text-white/90 sm:text-2xl">
            Everything You Need, All in One Shop
          </p>
          <p className="mt-4 max-w-lg text-base text-white/65 sm:text-lg">
            Tech, repairs, drinks, home essentials &amp; more — buy and sell phones, get same-day repairs, and stock up
            on everyday essentials, all under one roof in Purley.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button to="/shop" variant="accent" size="lg" iconRight={<ArrowRight className="h-5 w-5" />}>
              Shop Now
            </Button>
            <Button to="/repairs" variant="outline" size="lg" icon={<Wrench className="h-5 w-5" />}>
              Book a Repair
            </Button>
            <Button to="/contact" variant="whiteOnDark" size="lg" icon={<MessageCircle className="h-5 w-5" />}>
              Contact Us
            </Button>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-white/70">
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-teal-300" /> Trusted Local Shop</span>
            <span className="flex items-center gap-2"><Zap className="h-4 w-4 text-accent-300" /> Same-Day Repairs</span>
            <span className="flex items-center gap-2"><Star className="h-4 w-4 text-brand-300" /> New, Used &amp; Refurbished</span>
          </div>
        </div>

        <Hero3DGate />
      </div>
    </section>
  );
}
