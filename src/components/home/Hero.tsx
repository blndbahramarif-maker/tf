import { ArrowRight, Wrench, MessageCircle, Star, ShieldCheck, Zap } from "lucide-react";
import { Button } from "../ui/Button";
import {
  PhoneIllustration,
  HeadphoneIllustration,
  ColaCanIllustration,
  MugIllustration,
  ToyRobotIllustration,
  CaseIllustration,
} from "../illustrations/Illustrations";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-ink-950 via-brand-950 to-brand-900 pb-24 pt-14 text-white sm:pb-32 sm:pt-20">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute -left-32 top-10 h-72 w-72 animate-blob rounded-full bg-brand-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 animate-blob rounded-full bg-accent-500/20 blur-3xl" style={{ animationDelay: "3s" }} />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-brand-200 backdrop-blur">
            <Star className="h-3.5 w-3.5 fill-accent-400 text-accent-400" /> Purley's Local Tech &amp; Everyday Shop
          </span>
          <h1 className="mt-6 text-balance font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            DGN Tech <span className="bg-gradient-to-r from-brand-300 via-accent-300 to-teal-300 bg-clip-text text-transparent">Mobiles</span>
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

        <div className="relative mx-auto hidden h-[420px] w-full max-w-md md:block">
          <div className="glass absolute inset-8 rounded-[3rem]" />
          <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 animate-float">
            <PhoneIllustration className="h-full w-full drop-shadow-2xl" />
          </div>
          <div className="absolute left-2 top-4 h-24 w-24 animate-float-slow" style={{ animationDelay: "0.5s" }}>
            <HeadphoneIllustration className="h-full w-full drop-shadow-xl" />
          </div>
          <div className="absolute right-0 top-10 h-20 w-20 animate-float" style={{ animationDelay: "1.2s" }}>
            <CaseIllustration className="h-full w-full drop-shadow-xl" />
          </div>
          <div className="absolute bottom-6 left-6 h-20 w-20 animate-float-slow" style={{ animationDelay: "0.8s" }}>
            <ColaCanIllustration className="h-full w-full drop-shadow-xl" />
          </div>
          <div className="absolute bottom-2 right-4 h-24 w-24 animate-float" style={{ animationDelay: "1.6s" }}>
            <MugIllustration className="h-full w-full drop-shadow-xl" />
          </div>
          <div className="absolute right-16 top-0 h-16 w-16 animate-float-slow" style={{ animationDelay: "2s" }}>
            <ToyRobotIllustration className="h-full w-full drop-shadow-xl" />
          </div>
        </div>
      </div>
    </section>
  );
}
