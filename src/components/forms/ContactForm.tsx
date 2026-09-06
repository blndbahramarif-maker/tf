import { useState, type FormEvent } from "react";
import { CheckCircle2, Send } from "lucide-react";

export function ContactForm() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) {
      setError("Please fill in your name, email and message.");
      return;
    }
    setError(null);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center rounded-3xl border border-brand-100 bg-brand-50 p-10 text-center">
        <CheckCircle2 className="h-14 w-14 text-brand-600" />
        <h3 className="mt-4 font-display text-2xl font-bold text-ink-950">Message Sent!</h3>
        <p className="mt-2 max-w-md text-ink-950/60">
          Thanks {form.name.split(" ")[0]}, we've received your message and will get back to you as soon as possible.
        </p>
        <button
          onClick={() => {
            setForm({ name: "", phone: "", email: "", message: "" });
            setSubmitted(false);
          }}
          className="mt-6 rounded-full bg-ink-950 px-6 py-3 text-sm font-bold text-white hover:bg-ink-900"
        >
          Send Another Message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-ink-950/5 bg-white p-6 shadow-soft sm:p-8">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="block text-sm font-bold text-ink-950/80">
          Name *
          <input
            className="input mt-1.5 font-normal"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Your name"
          />
        </label>
        <label className="block text-sm font-bold text-ink-950/80">
          Phone Number
          <input
            className="input mt-1.5 font-normal"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="07xxx xxxxxx"
          />
        </label>
        <label className="block text-sm font-bold text-ink-950/80 sm:col-span-2">
          Email *
          <input
            type="email"
            className="input mt-1.5 font-normal"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="you@example.com"
          />
        </label>
        <label className="block text-sm font-bold text-ink-950/80 sm:col-span-2">
          Message *
          <textarea
            className="input mt-1.5 min-h-32 resize-y font-normal"
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            placeholder="How can we help?"
          />
        </label>
      </div>
      {error && <p className="mt-4 text-sm font-semibold text-rose-600">{error}</p>}
      <button
        type="submit"
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-4 text-base font-bold text-white shadow-glow transition-transform hover:-translate-y-0.5 sm:w-auto"
      >
        <Send className="h-5 w-5" /> Send Message
      </button>
    </form>
  );
}
