import { MapPin, Phone, Mail, Navigation, Clock } from "lucide-react";
import { Section, SectionHeading } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { ContactForm } from "../components/forms/ContactForm";
import { MapEmbed, DIRECTIONS_URL } from "../components/shared/MapEmbed";
import { usePageMeta } from "../lib/usePageMeta";

export default function Contact() {
  usePageMeta(
    "Contact Us",
    "Get in touch with DGN Tech Mobiles in Purley — call, email, get directions or send us a message."
  );
  return (
    <div>
      <div className="relative overflow-hidden bg-gradient-to-br from-ink-950 via-brand-950 to-brand-800 py-16 text-white sm:py-24">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest">
            Get In Touch
          </span>
          <h1 className="mt-5 text-balance font-display text-4xl font-extrabold sm:text-5xl">Contact DGN Tech Mobiles</h1>
          <p className="mt-4 text-white/75">We'd love to hear from you — pop in, call, email or send us a message.</p>
        </div>
      </div>

      <Section>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="rounded-3xl border border-ink-950/5 bg-white p-7 shadow-soft">
              <h3 className="font-display text-xl font-bold text-ink-950">DGN Tech Mobiles</h3>
              <div className="mt-5 space-y-4 text-sm text-ink-950/70">
                <p className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                  10 Russell Hill Road, Purley, CR8 2LA, United Kingdom
                </p>
                <p className="flex items-center gap-3">
                  <Phone className="h-5 w-5 shrink-0 text-brand-600" /> 07939 294583
                </p>
                <p className="flex items-center gap-3">
                  <Mail className="h-5 w-5 shrink-0 text-brand-600" /> dgntechpurley@gmail.com
                </p>
                <p className="flex items-center gap-3">
                  <Clock className="h-5 w-5 shrink-0 text-brand-600" /> Mon – Sat: 9:00 – 18:00
                </p>
              </div>
              <div className="mt-6 grid grid-cols-1 gap-3">
                <Button href="tel:07939294583" variant="primary" icon={<Phone className="h-4 w-4" />}>
                  Call Us
                </Button>
                <Button href="mailto:dgntechpurley@gmail.com" variant="subtle" icon={<Mail className="h-4 w-4" />}>
                  Email Us
                </Button>
                <Button href={DIRECTIONS_URL} variant="ghost" icon={<Navigation className="h-4 w-4" />}>
                  Get Directions
                </Button>
              </div>
            </div>
          </div>
          <div className="lg:col-span-3">
            <ContactForm />
          </div>
        </div>
      </Section>

      <Section className="pt-0">
        <SectionHeading eyebrow="Find Us" title="Visit Our Shop in Purley" />
        <div className="overflow-hidden rounded-3xl border border-ink-950/5 shadow-soft">
          <MapEmbed className="h-[420px] w-full border-0" />
        </div>
      </Section>
    </div>
  );
}
