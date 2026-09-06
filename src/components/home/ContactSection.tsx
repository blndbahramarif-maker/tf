import { MapPin, Phone, Mail, Clock, Navigation } from "lucide-react";
import { Section, SectionHeading } from "../ui/Section";
import { Button } from "../ui/Button";
import { MapEmbed, DIRECTIONS_URL } from "../shared/MapEmbed";

export function ContactSection() {
  return (
    <Section>
      <SectionHeading eyebrow="Visit The Shop" title="Come and Say Hello" />
      <div className="grid grid-cols-1 gap-8 overflow-hidden rounded-3xl border border-ink-950/5 bg-white shadow-soft lg:grid-cols-2">
        <div className="flex flex-col justify-center gap-6 p-8 sm:p-10">
          <h3 className="font-display text-2xl font-bold text-ink-950">DGN Tech Mobiles</h3>
          <div className="space-y-4 text-ink-950/70">
            <p className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
              10 Russell Hill Road, Purley, CR8 2LA, United Kingdom
            </p>
            <p className="flex items-center gap-3">
              <Phone className="h-5 w-5 shrink-0 text-brand-600" />
              <a href="tel:07939294583" className="font-semibold hover:text-brand-600">07939 294583</a>
            </p>
            <p className="flex items-center gap-3">
              <Mail className="h-5 w-5 shrink-0 text-brand-600" />
              <a href="mailto:dgntechpurley@gmail.com" className="font-semibold hover:text-brand-600">dgntechpurley@gmail.com</a>
            </p>
            <p className="flex items-center gap-3">
              <Clock className="h-5 w-5 shrink-0 text-brand-600" />
              Mon – Sat: 9:00 – 18:00
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href={DIRECTIONS_URL} variant="primary" icon={<Navigation className="h-4 w-4" />}>
              Get Directions
            </Button>
            <Button to="/contact" variant="ghost">
              Contact Us
            </Button>
          </div>
        </div>
        <div className="min-h-[320px]">
          <MapEmbed className="h-full w-full border-0" />
        </div>
      </div>
    </Section>
  );
}
