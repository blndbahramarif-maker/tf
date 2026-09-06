import { Section, SectionHeading } from "../components/ui/Section";
import { usePageMeta } from "../lib/usePageMeta";

export default function Terms() {
  usePageMeta("Terms and Conditions", "Terms and Conditions for DGN Tech Mobiles.");
  return (
    <Section>
      <SectionHeading eyebrow="Legal" title="Terms and Conditions" align="left" />
      <div className="max-w-3xl space-y-6 text-ink-950/70">
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Orders &amp; Availability</h2>
          <p>
            Product prices, descriptions and images on this website are provided as a guide. Stock availability may
            change, and we'll always contact you if there's an issue with your order.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Repairs</h2>
          <p>
            Repair pricing shown is a guide only — final pricing is confirmed after a diagnostic check of your
            device. Same-day and next-day turnaround depends on parts availability and current workload.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Used &amp; Refurbished Devices</h2>
          <p>
            Used and refurbished devices are tested before sale and come with a 90-day in-store warranty unless
            otherwise stated. This does not affect your statutory rights.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Age-Restricted Products</h2>
          <p>
            Vape products are sold strictly to customers aged 18 and over, in line with UK law. We reserve the right
            to request proof of age for any age-restricted purchase.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Contact</h2>
          <p>
            For any questions about these terms, contact us at{" "}
            <a href="mailto:dgntechpurley@gmail.com" className="font-semibold text-brand-600">dgntechpurley@gmail.com</a>{" "}
            or call 07939 294583.
          </p>
        </div>
        <p className="text-sm text-ink-950/40">This is a placeholder set of terms for demonstration purposes. Please replace with terms reviewed by a qualified professional before publishing live.</p>
      </div>
    </Section>
  );
}
