import { Section, SectionHeading } from "../components/ui/Section";
import { usePageMeta } from "../lib/usePageMeta";

export default function Privacy() {
  usePageMeta("Privacy Policy", "Privacy Policy for DGN Tech Mobiles.");
  return (
    <Section>
      <SectionHeading eyebrow="Legal" title="Privacy Policy" align="left" />
      <div className="max-w-3xl space-y-6 text-ink-950/70">
        <p>
          DGN Tech Mobiles ("we", "us", "our") is committed to protecting your privacy. This policy explains how we
          collect, use and safeguard your information when you visit our website or use our in-store services.
        </p>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Information We Collect</h2>
          <p>
            When you contact us, book a repair, or place an order, we may collect your name, phone number, email
            address, and details about your device or order. We only use this information to provide our products
            and services to you.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">How We Use Your Information</h2>
          <p>
            We use your details to process repair bookings, orders and enquiries, to contact you about your order or
            repair, and to improve our products and services. We do not sell your personal information to third
            parties.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Data Security</h2>
          <p>
            We take reasonable steps to protect your personal information from loss, misuse and unauthorised access.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Your Rights</h2>
          <p>
            You can ask us at any time what information we hold about you, and request that it be corrected or
            deleted, by contacting us at{" "}
            <a href="mailto:dgntechpurley@gmail.com" className="font-semibold text-brand-600">dgntechpurley@gmail.com</a>.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-display text-xl font-bold text-ink-950">Contact Us</h2>
          <p>
            DGN Tech Mobiles, 10 Russell Hill Road, Purley, CR8 2LA, United Kingdom. Phone: 07939 294583. Email:
            dgntechpurley@gmail.com.
          </p>
        </div>
        <p className="text-sm text-ink-950/40">This is a placeholder policy for demonstration purposes. Please replace with a policy reviewed by a qualified professional before publishing live.</p>
      </div>
    </Section>
  );
}
