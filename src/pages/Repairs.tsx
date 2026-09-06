import { Smartphone, Tablet, Tv, Zap, CalendarClock, PhoneCall } from "lucide-react";
import { Section, SectionHeading } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { RepairBookingForm } from "../components/forms/RepairBookingForm";
import { phoneRepairs, tabletRepairs, tvRepairs } from "../data/repairs";
import { ToolsIllustration } from "../components/illustrations/Illustrations";
import { usePageMeta } from "../lib/usePageMeta";

function RepairGroup({
  icon: Icon,
  title,
  items,
  gradient,
}: {
  icon: typeof Smartphone;
  title: string;
  items: { title: string; price: string; description: string }[];
  gradient: string;
}) {
  return (
    <div className="rounded-3xl border border-ink-950/5 bg-white p-6 shadow-soft sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient}`}>
          <Icon className="h-6 w-6 text-white" />
        </span>
        <h3 className="font-display text-xl font-bold text-ink-950">{title}</h3>
      </div>
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.title} className="flex items-start justify-between gap-4 border-b border-ink-950/5 pb-4 last:border-0 last:pb-0">
            <div>
              <p className="font-bold text-ink-950">{item.title}</p>
              <p className="text-sm text-ink-950/55">{item.description}</p>
            </div>
            <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">{item.price}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Repairs() {
  usePageMeta(
    "Phone, iPad, Tablet & TV Repairs",
    "Same-day and next-day phone, iPad, tablet and TV repairs at DGN Tech Mobiles, Purley. Book your repair online today."
  );
  return (
    <div>
      <div className="relative overflow-hidden bg-gradient-to-br from-rose-600 via-orange-600 to-accent-600 py-16 text-white sm:py-24">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="pointer-events-none absolute -right-16 top-10 h-64 w-64 animate-blob rounded-full bg-white/10 blur-2xl" />
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/15 px-4 py-1.5 text-xs font-bold uppercase tracking-widest backdrop-blur">
              <Zap className="h-3.5 w-3.5" /> Same-Day or Next-Day Repair Available
            </span>
            <h1 className="mt-5 text-balance font-display text-4xl font-extrabold leading-tight sm:text-5xl">
              Expert Repairs for Phones, iPads, Tablets &amp; TVs
            </h1>
            <p className="mt-5 max-w-lg text-balance text-white/85">
              Broken screen, battery issue, water damage or a TV that won't switch on — our experienced technicians
              get you back up and running fast.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="#booking-form" variant="white">
                Book Your Repair
              </Button>
              <Button href="tel:07939294583" variant="whiteOnDark" icon={<PhoneCall className="h-4 w-4" />}>
                Call 07939 294583
              </Button>
            </div>
          </div>
          <div className="mx-auto hidden h-64 w-64 animate-float md:block">
            <ToolsIllustration className="h-full w-full drop-shadow-2xl" />
          </div>
        </div>
      </div>

      <Section>
        <SectionHeading
          eyebrow="Repair Services"
          title="Fast, Reliable Device Repairs"
          description="Transparent guide pricing for our most common repairs. Final pricing confirmed after a quick diagnostic check."
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <RepairGroup icon={Smartphone} title="Phone Repairs" items={phoneRepairs} gradient="from-brand-500 to-brand-700" />
          <RepairGroup icon={Tablet} title="iPad & Tablet Repairs" items={tabletRepairs} gradient="from-teal-400 to-teal-600" />
          <RepairGroup icon={Tv} title="TV Repairs" items={tvRepairs} gradient="from-accent-400 to-accent-600" />
        </div>
      </Section>

      <Section className="bg-ink-950 text-white">
        <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest">
              <CalendarClock className="h-3.5 w-3.5" /> Turnaround
            </span>
            <h2 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">
              SAME-DAY OR NEXT-DAY REPAIR AVAILABLE
            </h2>
            <p className="mt-4 text-white/70">
              Most common repairs — like screen and battery replacements — can be completed the same day. More
              involved repairs are usually ready the next day. We'll always confirm timing when you book.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="glass rounded-2xl p-6 text-center">
              <p className="font-display text-3xl font-extrabold text-teal-300">Same-Day</p>
              <p className="mt-1 text-sm text-white/60">Screens, batteries &amp; charging ports</p>
            </div>
            <div className="glass rounded-2xl p-6 text-center">
              <p className="font-display text-3xl font-extrabold text-accent-300">Next-Day</p>
              <p className="mt-1 text-sm text-white/60">Water damage &amp; complex repairs</p>
            </div>
          </div>
        </div>
      </Section>

      <Section id="booking-form" className="bg-gradient-to-b from-white to-brand-50/40">
        <div className="mx-auto max-w-2xl">
          <SectionHeading eyebrow="Book Online" title="Book Your Repair Today" />
          <RepairBookingForm />
        </div>
      </Section>
    </div>
  );
}
