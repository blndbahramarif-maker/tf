import { Zap, ArrowRight } from "lucide-react";
import { Button } from "../ui/Button";

export function RepairBanner() {
  return (
    <div className="mx-auto -mt-12 max-w-6xl px-4 sm:px-6 lg:px-8">
      <div className="animate-fade-up relative overflow-hidden rounded-3xl bg-gradient-to-r from-accent-500 via-accent-600 to-rose-600 px-6 py-8 shadow-[0_25px_70px_-15px_rgba(240,79,6,0.5)] sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 animate-blob rounded-full bg-white/15" />
        <div className="relative flex flex-col items-center justify-between gap-6 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <Zap className="h-7 w-7 text-white" />
            </span>
            <div>
              <p className="font-display text-xl font-extrabold text-white sm:text-2xl">
                SAME-DAY OR NEXT-DAY FIX
              </p>
              <p className="text-sm text-white/90">Phones, iPads, tablets &amp; TVs — repaired fast by our expert team.</p>
            </div>
          </div>
          <Button to="/repairs" variant="white" iconRight={<ArrowRight className="h-4 w-4" />} className="shrink-0">
            Book Your Repair
          </Button>
        </div>
      </div>
    </div>
  );
}
