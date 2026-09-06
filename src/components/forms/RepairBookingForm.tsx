import { useState, type FormEvent } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { deviceTypes, deviceBrands } from "../../data/repairs";

const initialForm = {
  name: "",
  phone: "",
  email: "",
  deviceType: deviceTypes[0],
  deviceBrand: deviceBrands[0],
  deviceModel: "",
  problem: "",
  preferredDate: "",
};

export function RepairBookingForm() {
  const [form, setForm] = useState(initialForm);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof initialForm>(key: K, value: (typeof initialForm)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.phone || !form.email || !form.deviceModel || !form.problem) {
      setError("Please fill in all required fields.");
      return;
    }
    setError(null);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center rounded-3xl border border-teal-100 bg-teal-50 p-10 text-center">
        <CheckCircle2 className="h-14 w-14 text-teal-600" />
        <h3 className="mt-4 font-display text-2xl font-bold text-ink-950">Repair Request Received!</h3>
        <p className="mt-2 max-w-md text-ink-950/60">
          Thanks {form.name.split(" ")[0]}, we've received your {form.deviceType.toLowerCase()} repair request. We'll
          call or email you shortly on {form.phone || form.email} to confirm your booking.
        </p>
        <button
          onClick={() => {
            setForm(initialForm);
            setSubmitted(false);
          }}
          className="mt-6 rounded-full bg-ink-950 px-6 py-3 text-sm font-bold text-white hover:bg-ink-900"
        >
          Book Another Repair
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-ink-950/5 bg-white p-6 shadow-soft sm:p-8">
      <h3 className="font-display text-2xl font-bold text-ink-950">Book Your Repair</h3>
      <p className="mt-1 text-sm text-ink-950/60">
        Fill in your details below and we'll confirm your same-day or next-day repair slot.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Full Name" required>
          <input
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="input"
            placeholder="John Smith"
          />
        </Field>
        <Field label="Phone Number" required>
          <input
            required
            type="tel"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className="input"
            placeholder="07xxx xxxxxx"
          />
        </Field>
        <Field label="Email Address" required className="sm:col-span-2">
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className="input"
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Device Type" required>
          <select value={form.deviceType} onChange={(e) => update("deviceType", e.target.value)} className="input">
            {deviceTypes.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Device Brand" required>
          <select value={form.deviceBrand} onChange={(e) => update("deviceBrand", e.target.value)} className="input">
            {deviceBrands.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
        <Field label="Device Model" required className="sm:col-span-2">
          <input
            required
            value={form.deviceModel}
            onChange={(e) => update("deviceModel", e.target.value)}
            className="input"
            placeholder="e.g. iPhone 13, iPad Air, Samsung Galaxy S23"
          />
        </Field>
        <Field label="Description of the Problem" required className="sm:col-span-2">
          <textarea
            required
            value={form.problem}
            onChange={(e) => update("problem", e.target.value)}
            className="input min-h-28 resize-y"
            placeholder="Tell us what's wrong with your device..."
          />
        </Field>
        <Field label="Preferred Repair Date" className="sm:col-span-2">
          <input
            type="date"
            value={form.preferredDate}
            onChange={(e) => update("preferredDate", e.target.value)}
            className="input"
          />
        </Field>
      </div>

      {error && <p className="mt-4 text-sm font-semibold text-rose-600">{error}</p>}

      <button
        type="submit"
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent-500 to-accent-600 px-6 py-4 text-base font-bold text-white shadow-[0_15px_40px_-12px_rgba(240,79,6,0.55)] transition-transform hover:-translate-y-0.5 sm:w-auto"
      >
        <Send className="h-5 w-5" /> Book Your Repair
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm font-bold text-ink-950/80 ${className}`}>
      {label} {required && <span className="text-accent-600">*</span>}
      <div className="mt-1.5 font-normal">{children}</div>
    </label>
  );
}
