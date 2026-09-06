import { Link } from "react-router-dom";
import { MapPin, Phone, Mail, Clock } from "lucide-react";

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M13.5 21v-8h2.7l.4-3.2h-3.1V7.7c0-.9.3-1.6 1.6-1.6h1.7V3.2C16.5 3.1 15.5 3 14.4 3c-2.4 0-4.1 1.5-4.1 4.2v2.6H7.6v3.2h2.7v8h3.2z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="bg-ink-950 text-white/80">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div>
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-white">
                <rect x="7" y="2" width="10" height="20" rx="2.5" fill="currentColor" opacity="0.95" />
                <rect x="9" y="5" width="6" height="12" rx="0.5" fill="#4a17cc" />
                <circle cx="12" cy="19" r="1" fill="#4a17cc" />
              </svg>
            </span>
            <span className="font-display text-lg font-extrabold text-white">DGN Tech Mobiles</span>
          </div>
          <p className="text-sm leading-relaxed text-white/60">
            Your local shop for technology, repairs and everyday essentials in Purley.
          </p>
          <div className="mt-5 flex gap-3">
            <a href="#" aria-label="Facebook" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
              <FacebookIcon />
            </a>
            <a href="#" aria-label="Instagram" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
              <InstagramIcon />
            </a>
          </div>
        </div>

        <div>
          <h4 className="mb-4 font-display text-sm font-bold uppercase tracking-wide text-white">Quick Links</h4>
          <ul className="space-y-2.5 text-sm">
            <li><Link to="/" className="hover:text-white">Home</Link></li>
            <li><Link to="/shop" className="hover:text-white">Shop</Link></li>
            <li><Link to="/repairs" className="hover:text-white">Repairs</Link></li>
            <li><Link to="/about" className="hover:text-white">About Us</Link></li>
            <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="mb-4 font-display text-sm font-bold uppercase tracking-wide text-white">Shop Categories</h4>
          <ul className="space-y-2.5 text-sm">
            <li><Link to="/phones" className="hover:text-white">Phones & Technology</Link></li>
            <li><Link to="/accessories" className="hover:text-white">Phone Accessories</Link></li>
            <li><Link to="/drinks" className="hover:text-white">Drinks</Link></li>
            <li><Link to="/kitchen" className="hover:text-white">Kitchen & Home</Link></li>
            <li><Link to="/toys" className="hover:text-white">Kids' Toys</Link></li>
            <li><Link to="/vape" className="hover:text-white">Vape Products (18+)</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="mb-4 font-display text-sm font-bold uppercase tracking-wide text-white">Visit Us</h4>
          <ul className="space-y-3 text-sm text-white/70">
            <li className="flex gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              <span>10 Russell Hill Road, Purley, CR8 2LA, United Kingdom</span>
            </li>
            <li className="flex gap-2.5">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              <a href="tel:07939294583" className="hover:text-white">07939 294583</a>
            </li>
            <li className="flex gap-2.5">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              <a href="mailto:dgntechpurley@gmail.com" className="hover:text-white">dgntechpurley@gmail.com</a>
            </li>
            <li className="flex gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              <span>Mon–Sat: 9:00 – 18:00</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-white/50 sm:flex-row sm:px-6 lg:px-8">
          <p>© 2026 DGN Tech Mobiles. All Rights Reserved.</p>
          <div className="flex gap-5">
            <Link to="/privacy" className="hover:text-white">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-white">Terms and Conditions</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
