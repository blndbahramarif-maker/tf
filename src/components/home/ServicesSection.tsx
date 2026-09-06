import { Smartphone, Wrench, Tablet, Tv, Zap, CalendarClock, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Section, SectionHeading } from "../ui/Section";

const services = [
  {
    title: "Buy & Sell Phones",
    description: "Get a fair price for your old phone, or pick up a great used or refurbished handset.",
    icon: Smartphone,
    gradient: "from-brand-500 to-brand-700",
    href: "/phones",
  },
  {
    title: "Phone Repairs",
    description: "Screens, batteries, charging ports and more — fixed by experienced technicians.",
    icon: Wrench,
    gradient: "from-rose-500 to-orange-600",
    href: "/repairs",
  },
  {
    title: "iPad & Tablet Repairs",
    description: "Cracked screens and battery issues on iPads and tablets, sorted quickly.",
    icon: Tablet,
    gradient: "from-brand-400 to-brand-600",
    href: "/repairs",
  },
  {
    title: "TV Repairs",
    description: "Display, sound and power faults diagnosed and repaired for all major TV brands.",
    icon: Tv,
    gradient: "from-teal-400 to-teal-600",
    href: "/repairs",
  },
  {
    title: "Same-Day Repair",
    description: "Most common repairs completed while you shop or run errands nearby.",
    icon: Zap,
    gradient: "from-accent-400 to-accent-600",
    href: "/repairs",
  },
  {
    title: "Next-Day Repair",
    description: "For more involved repairs, drop off today and collect your device tomorrow.",
    icon: CalendarClock,
    gradient: "from-fuchsia-500 to-brand-600",
    href: "/repairs",
  },
];

export function ServicesSection() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Our Services"
        title="Everything Your Devices Need"
        description="From buying and selling phones to same-day repairs on phones, iPads, tablets and TVs — we've got you covered."
      />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s, i) => (
          <Link
            key={s.title}
            to={s.href}
            className="animate-fade-up card-hover group flex flex-col gap-4 rounded-3xl border border-ink-950/5 bg-white p-7 shadow-soft"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${s.gradient} shadow-lg`}>
              <s.icon className="h-7 w-7 text-white" />
            </div>
            <h3 className="font-display text-lg font-bold text-ink-950">{s.title}</h3>
            <p className="text-sm text-ink-950/60">{s.description}</p>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-bold text-brand-600">
              Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
