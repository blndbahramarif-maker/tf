import { Zap, CalendarCheck, ShieldCheck, Repeat, Layers, Smile } from "lucide-react";
import { Section, SectionHeading } from "../ui/Section";

const points = [
  { title: "Fast Repairs", description: "Most repairs turned around quickly by skilled technicians.", icon: Zap },
  { title: "Same-Day Service Available", description: "Need it fixed today? We offer same-day repairs where possible.", icon: CalendarCheck },
  { title: "Trusted Local Shop", description: "A genuine part of the Purley community, serving customers every day.", icon: ShieldCheck },
  { title: "Buy & Sell Phones", description: "Fair prices whether you're upgrading or looking for a bargain.", icon: Repeat },
  { title: "Wide Range of Products", description: "Tech, drinks, kitchenware and toys — all in one convenient shop.", icon: Layers },
  { title: "Friendly Customer Service", description: "Straightforward advice and a warm welcome, every visit.", icon: Smile },
];

export function WhyChooseUs() {
  return (
    <Section className="grain relative overflow-hidden bg-ink-950 text-white">
      <div className="pointer-events-none absolute -left-20 top-1/2 h-80 w-80 -translate-y-1/2 animate-blob rounded-full bg-brand-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 animate-blob rounded-full bg-teal-500/15 blur-3xl" />
      <SectionHeading eyebrow="Why Choose Us" title="A Shop You Can Rely On" light />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {points.map((p, i) => (
          <div
            key={p.title}
            className="animate-fade-up glass rounded-3xl p-7"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-accent-400">
              <p.icon className="h-6 w-6 text-white" />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-white">{p.title}</h3>
            <p className="mt-2 text-sm text-white/60">{p.description}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
