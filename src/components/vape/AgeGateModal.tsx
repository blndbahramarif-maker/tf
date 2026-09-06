import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

const SESSION_KEY = "dgn-age-verified-18plus";

export function AgeGateModal({ onVerified }: { onVerified: () => void }) {
  const [visible, setVisible] = useState(false);
  const [declined, setDeclined] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "true") {
        onVerified();
        return;
      }
    } catch {
      /* storage unavailable, fall through to show gate */
    }
    setVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirmAge() {
    try {
      sessionStorage.setItem(SESSION_KEY, "true");
    } catch {
      /* ignore */
    }
    setVisible(false);
    onVerified();
  }

  function declineAge() {
    setDeclined(true);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
        {declined ? (
          <>
            <ShieldAlert className="mx-auto h-12 w-12 text-rose-600" />
            <h2 className="mt-4 font-display text-xl font-bold text-ink-950">Age Restricted Content</h2>
            <p className="mt-3 text-sm text-ink-950/60">
              You must be 18 or over to view vape products. This section is not available to you.
            </p>
            <button
              onClick={() => navigate("/")}
              className="mt-6 w-full rounded-full bg-ink-950 px-6 py-3 text-sm font-bold text-white hover:bg-ink-900"
            >
              Return to Home Page
            </button>
          </>
        ) : (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
              <ShieldAlert className="h-8 w-8 text-slate-700" />
            </span>
            <h2 className="mt-4 font-display text-2xl font-bold text-ink-950">Age Verification Required</h2>
            <p className="mt-3 text-sm text-ink-950/60">
              This section contains vaping products. You must be <strong>18 years of age or older</strong> to enter.
              By continuing you confirm you are of legal age to purchase vaping products in the UK.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={declineAge}
                className="flex-1 rounded-full border border-ink-950/15 px-6 py-3 text-sm font-bold text-ink-950/70 hover:bg-ink-950/5"
              >
                I am under 18
              </button>
              <button
                onClick={confirmAge}
                className="flex-1 rounded-full bg-slate-800 px-6 py-3 text-sm font-bold text-white hover:bg-slate-900"
              >
                I am 18 or over
              </button>
            </div>
            <p className="mt-5 text-xs text-ink-950/40">
              DGN Tech Mobiles sells vape products responsibly and in line with UK law. ID may be requested in-store.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
