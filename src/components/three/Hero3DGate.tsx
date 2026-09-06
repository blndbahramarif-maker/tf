import { lazy, Suspense, useEffect, useState } from "react";
import { HeroVisualFallback } from "./HeroVisualFallback";
import { ThreeErrorBoundary } from "./ErrorBoundary";

const LazyHero3DScene = lazy(() => import("./Hero3DScene"));

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Hosts the hero's product visual. Renders the interactive 3D phone scene
 * when the browser supports WebGL and the visual is actually visible
 * (it's hidden below the `md` breakpoint, so we never pay for loading or
 * running WebGL on phones — matching the CSS that hides this slot on
 * small screens). Falls back to the original CSS/SVG floating visual for
 * reduced-motion users, unsupported browsers, or if the 3D chunk fails to
 * load for any reason — the hero never breaks.
 */
export function Hero3DGate() {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setWebglOk(supportsWebGL());
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    const mql = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const canRun3D = isDesktop && webglOk === true;

  return (
    <div className="relative mx-auto hidden h-[420px] w-full max-w-md md:block">
      {canRun3D ? (
        <ThreeErrorBoundary fallback={<HeroVisualFallback />}>
          <Suspense fallback={<HeroVisualFallback />}>
            <LazyHero3DScene reduced={reduced} />
          </Suspense>
        </ThreeErrorBoundary>
      ) : (
        <HeroVisualFallback />
      )}
    </div>
  );
}
