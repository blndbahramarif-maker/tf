import {
  PhoneIllustration,
  HeadphoneIllustration,
  ColaCanIllustration,
  MugIllustration,
  ToyRobotIllustration,
  CaseIllustration,
} from "../illustrations/Illustrations";

/**
 * Original CSS/SVG floating hero visual (content only, no outer sizing
 * wrapper — that's shared with the 3D scene via Hero3DGate). Used whenever
 * the 3D scene can't run (reduced-motion preference, no WebGL, the 3D chunk
 * fails to load, or while it's still downloading) so the hero never
 * regresses to nothing.
 */
export function HeroVisualFallback() {
  return (
    <>
      <div className="glass absolute inset-8 rounded-[3rem]" />
      <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 animate-float">
        <PhoneIllustration className="h-full w-full drop-shadow-2xl" />
      </div>
      <div className="absolute left-2 top-4 h-24 w-24 animate-float-slow" style={{ animationDelay: "0.5s" }}>
        <HeadphoneIllustration className="h-full w-full drop-shadow-xl" />
      </div>
      <div className="absolute right-0 top-10 h-20 w-20 animate-float" style={{ animationDelay: "1.2s" }}>
        <CaseIllustration className="h-full w-full drop-shadow-xl" />
      </div>
      <div className="absolute bottom-6 left-6 h-20 w-20 animate-float-slow" style={{ animationDelay: "0.8s" }}>
        <ColaCanIllustration className="h-full w-full drop-shadow-xl" />
      </div>
      <div className="absolute bottom-2 right-4 h-24 w-24 animate-float" style={{ animationDelay: "1.6s" }}>
        <MugIllustration className="h-full w-full drop-shadow-xl" />
      </div>
      <div className="absolute right-16 top-0 h-16 w-16 animate-float-slow" style={{ animationDelay: "2s" }}>
        <ToyRobotIllustration className="h-full w-full drop-shadow-xl" />
      </div>
    </>
  );
}
