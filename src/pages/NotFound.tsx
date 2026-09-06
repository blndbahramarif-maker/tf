import { Home, Search } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PhoneIllustration } from "../components/illustrations/Illustrations";
import { usePageMeta } from "../lib/usePageMeta";

export default function NotFound() {
  usePageMeta("Page Not Found", "The page you're looking for could not be found.");
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <div className="h-40 w-40 animate-float">
        <PhoneIllustration className="h-full w-full" />
      </div>
      <h1 className="mt-6 font-display text-4xl font-extrabold text-ink-950">404</h1>
      <p className="mt-2 text-lg font-semibold text-ink-950/70">We couldn't find that page.</p>
      <p className="mt-2 text-ink-950/50">
        The page you're looking for may have been moved or no longer exists. Let's get you back on track.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button to="/" variant="primary" icon={<Home className="h-4 w-4" />}>Back to Home</Button>
        <Button to="/shop" variant="ghost" icon={<Search className="h-4 w-4" />}>Browse Shop</Button>
      </div>
    </div>
  );
}
