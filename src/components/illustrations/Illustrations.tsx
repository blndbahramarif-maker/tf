import { useId, type SVGProps } from "react";

type IllustrationProps = SVGProps<SVGSVGElement> & { className?: string };

/**
 * Shared drop-shadow ellipse used under most illustrations to fake a
 * floating / 3D-inspired product presentation without external assets.
 */
function Shadow({ id }: { id: string }) {
  return (
    <ellipse
      cx="100"
      cy="182"
      rx="52"
      ry="10"
      fill={`url(#${id})`}
      opacity="0.55"
    />
  );
}

function useGradId(prefix: string) {
  const id = useId().replace(/:/g, "");
  return `${prefix}${id}`;
}

/* ---------------------------- Phones & Tech ---------------------------- */

export function PhoneIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("phone");
  const sh = useGradId("phoneShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b6bff" />
          <stop offset="100%" stopColor="#4a17cc" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#1e1052" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#1e1052" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <g>
        <rect x="62" y="18" width="76" height="150" rx="18" fill={`url(#${g})`} />
        <rect x="68" y="30" width="64" height="112" rx="4" fill="#eef0ff" />
        <rect x="68" y="30" width="64" height="70" rx="4" fill="#c9befd" opacity="0.6" />
        <rect x="86" y="22" width="28" height="5" rx="2.5" fill="#2a1580" opacity="0.5" />
        <circle cx="100" cy="152" r="6.5" fill="#2a1580" opacity="0.4" />
        <rect x="76" y="46" width="30" height="6" rx="3" fill="#8b6bff" opacity="0.7" />
        <rect x="76" y="58" width="48" height="4" rx="2" fill="#c9befd" />
        <rect x="76" y="66" width="40" height="4" rx="2" fill="#c9befd" />
        <rect x="130" y="60" width="4" height="18" rx="2" fill="#3c169f" />
      </g>
    </svg>
  );
}

export function TabletIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("tab");
  const sh = useGradId("tabShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9c8bff" />
          <stop offset="100%" stopColor="#5b21f2" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#1e1052" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1e1052" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="36" y="26" width="128" height="140" rx="14" fill={`url(#${g})`} />
      <rect x="46" y="36" width="108" height="112" rx="3" fill="#eef0ff" />
      <rect x="46" y="36" width="108" height="56" rx="3" fill="#c9befd" opacity="0.55" />
      <circle cx="100" cy="157" r="4.5" fill="#2a1580" opacity="0.5" />
      <rect x="58" y="52" width="46" height="8" rx="4" fill="#8b6bff" opacity="0.7" />
      <rect x="58" y="66" width="70" height="4" rx="2" fill="#c9befd" />
      <rect x="58" y="74" width="60" height="4" rx="2" fill="#c9befd" />
    </svg>
  );
}

export function TVIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("tv");
  const sh = useGradId("tvShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4b5563" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
        <linearGradient id={`${g}scr`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b6bff" />
          <stop offset="100%" stopColor="#2dd4c4" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#111827" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#111827" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="26" y="34" width="148" height="98" rx="10" fill={`url(#${g})`} />
      <rect x="36" y="44" width="128" height="78" rx="4" fill={`url(#${g}scr)`} opacity="0.9" />
      <rect x="92" y="132" width="16" height="18" fill="#374151" />
      <rect x="66" y="150" width="68" height="8" rx="4" fill="#374151" />
    </svg>
  );
}

/* --------------------------- Phone Accessories -------------------------- */

export function CaseIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("case");
  const sh = useGradId("caseShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff9a5c" />
          <stop offset="100%" stopColor="#f04f06" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#7c2d12" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="58" y="20" width="84" height="152" rx="22" fill={`url(#${g})`} />
      <rect x="66" y="30" width="68" height="120" rx="10" fill="#ffe9d3" opacity="0.35" />
      <circle cx="118" cy="42" r="9" fill="#7c2d12" opacity="0.4" />
      <circle cx="118" cy="42" r="5" fill="#ffe9d3" opacity="0.8" />
      <rect x="58" y="86" width="6" height="20" rx="3" fill="#c73a05" />
      <rect x="136" y="80" width="6" height="14" rx="3" fill="#c73a05" />
    </svg>
  );
}

export function ChargerIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("chg");
  const sh = useGradId("chgShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7f7ff" />
          <stop offset="100%" stopColor="#cec4ff" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#1e1052" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1e1052" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="70" y="30" width="60" height="46" rx="12" fill={`url(#${g})`} />
      <rect x="90" y="76" width="20" height="10" fill="#cec4ff" />
      <rect x="60" y="44" width="8" height="6" fill="#5b21f2" />
      <rect x="60" y="56" width="8" height="6" fill="#5b21f2" />
      <path d="M96 96 C 60 110, 60 140, 96 156" stroke="#4a17cc" strokeWidth="6" fill="none" strokeLinecap="round" />
      <rect x="86" y="150" width="34" height="16" rx="6" fill="#5b21f2" />
      <rect x="90" y="154" width="10" height="8" rx="2" fill="#eef0ff" />
      <rect x="104" y="154" width="10" height="8" rx="2" fill="#eef0ff" />
    </svg>
  );
}

export function CableIllustration({ className, ...rest }: IllustrationProps) {
  const sh = useGradId("cabShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#1e1052" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1e1052" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <path d="M40 60 C 90 40, 90 100, 130 90 S 170 60, 165 40" stroke="#5b21f2" strokeWidth="9" fill="none" strokeLinecap="round" />
      <rect x="26" y="50" width="20" height="20" rx="5" fill="#8b6bff" />
      <rect x="150" y="30" width="26" height="16" rx="4" fill="#8b6bff" />
      <rect x="176" y="34" width="8" height="8" rx="2" fill="#5b21f2" />
      <path d="M60 120 C 100 145, 60 165, 100 178" stroke="#2dd4c4" strokeWidth="9" fill="none" strokeLinecap="round" />
      <rect x="46" y="110" width="20" height="20" rx="5" fill="#67e8d8" />
      <rect x="92" y="170" width="24" height="16" rx="4" fill="#67e8d8" />
    </svg>
  );
}

export function HeadphoneIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("hp");
  const sh = useGradId("hpShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ab99ff" />
          <stop offset="100%" stopColor="#4a17cc" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#1e1052" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#1e1052" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <path d="M46 100 C 46 55, 154 55, 154 100" stroke={`url(#${g})`} strokeWidth="14" fill="none" strokeLinecap="round" />
      <rect x="30" y="96" width="30" height="52" rx="15" fill={`url(#${g})`} />
      <rect x="140" y="96" width="30" height="52" rx="15" fill={`url(#${g})`} />
      <ellipse cx="45" cy="122" rx="9" ry="18" fill="#eef0ff" opacity="0.7" />
      <ellipse cx="155" cy="122" rx="9" ry="18" fill="#eef0ff" opacity="0.7" />
    </svg>
  );
}

export function EarbudsIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("eb");
  const sh = useGradId("ebShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cec4ff" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#1e1052" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1e1052" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="66" y="70" width="68" height="86" rx="20" fill={`url(#${g})`} />
      <rect x="78" y="60" width="18" height="16" rx="8" fill="#5b21f2" opacity="0.15" />
      <circle cx="84" cy="98" r="16" fill="#5b21f2" />
      <circle cx="84" cy="98" r="7" fill="#cec4ff" />
      <rect x="76" y="118" width="16" height="26" rx="8" fill="#8b6bff" />
      <circle cx="116" cy="98" r="16" fill="#5b21f2" />
      <circle cx="116" cy="98" r="7" fill="#cec4ff" />
      <rect x="108" y="118" width="16" height="26" rx="8" fill="#8b6bff" />
    </svg>
  );
}

export function PowerbankIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("pb");
  const sh = useGradId("pbShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#374151" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#111827" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#111827" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="55" y="46" width="90" height="112" rx="16" fill={`url(#${g})`} />
      <rect x="88" y="60" width="6" height="26" rx="3" fill="#2dd4c4" transform="rotate(20 91 73)" />
      <circle cx="75" cy="120" r="6" fill="#2dd4c4" opacity="0.9" />
      <circle cx="95" cy="120" r="6" fill="#2dd4c4" opacity="0.6" />
      <circle cx="115" cy="120" r="6" fill="#2dd4c4" opacity="0.3" />
      <rect x="70" y="140" width="60" height="6" rx="3" fill="#4b5563" />
    </svg>
  );
}

export function ScreenProtectorIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("sp");
  const sh = useGradId("spShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dff7ff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#8b6bff" stopOpacity="0.6" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#1e1052" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#1e1052" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="64" y="22" width="72" height="144" rx="18" fill="#eef0ff" />
      <rect x="74" y="16" width="60" height="140" rx="16" fill={`url(#${g})`} stroke="#ffffff" strokeWidth="2" />
      <line x1="86" y1="30" x2="122" y2="140" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="10" />
    </svg>
  );
}

export function PhoneHolderIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("ph2");
  const sh = useGradId("ph2Shadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4b5563" />
          <stop offset="100%" stopColor="#1f2937" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#111827" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#111827" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="86" y="140" width="28" height="20" rx="4" fill={`url(#${g})`} />
      <rect x="94" y="90" width="12" height="54" fill={`url(#${g})`} />
      <g transform="rotate(-18 100 90)">
        <rect x="70" y="46" width="60" height="88" rx="12" fill="#5b21f2" />
        <rect x="76" y="54" width="48" height="66" rx="4" fill="#eef0ff" opacity="0.85" />
      </g>
    </svg>
  );
}

/* -------------------------------- Drinks -------------------------------- */

const canTones = {
  red: { dark: "#7f1d1d", mid: "#ef4444", base: "#991b1b", stripe: "#dc2626" },
  blue: { dark: "#1e3a8a", mid: "#3b82f6", base: "#1e40af", stripe: "#2563eb" },
  orange: { dark: "#9a3412", mid: "#fb923c", base: "#c2410c", stripe: "#f97316" },
  green: { dark: "#14532d", mid: "#4ade80", base: "#166534", stripe: "#22c55e" },
  black: { dark: "#0f172a", mid: "#334155", base: "#020617", stripe: "#475569" },
} as const;

function Can({ className, tone, ...rest }: IllustrationProps & { tone: keyof typeof canTones }) {
  const g = useGradId("can");
  const sh = useGradId("canShadow");
  const c = canTones[tone];
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={c.dark} />
          <stop offset="45%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.dark} />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor={c.dark} stopOpacity="0.4" />
          <stop offset="100%" stopColor={c.dark} stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="72" y="30" width="56" height="130" rx="10" fill={`url(#${g})`} />
      <ellipse cx="100" cy="30" rx="28" ry="8" fill="#e5e7eb" />
      <ellipse cx="100" cy="160" rx="28" ry="8" fill={c.base} />
      <rect x="76" y="70" width="48" height="34" rx="4" fill="#ffffff" opacity="0.92" />
      <path d="M80 87 q10 -10 20 0 t20 0" stroke={c.stripe} strokeWidth="4" fill="none" />
      <circle cx="100" cy="24" r="6" fill="#9ca3af" />
    </svg>
  );
}

export function ColaCanIllustration(props: IllustrationProps) {
  return <Can {...props} tone="red" />;
}
export function DarkColaCanIllustration(props: IllustrationProps) {
  return <Can {...props} tone="black" />;
}
export function PepsiCanIllustration(props: IllustrationProps) {
  return <Can {...props} tone="blue" />;
}
export function OrangeCanIllustration(props: IllustrationProps) {
  return <Can {...props} tone="orange" />;
}
export function LimeCanIllustration(props: IllustrationProps) {
  return <Can {...props} tone="green" />;
}

export function WaterBottleIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("water");
  const sh = useGradId("waterShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.5" />
          <stop offset="50%" stopColor="#bae6fd" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#0369a1" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#0369a1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="84" y="16" width="32" height="18" rx="4" fill="#38bdf8" />
      <path d="M80 34 h40 l6 20 v96 a10 10 0 0 1 -10 10 h-32 a10 10 0 0 1 -10 -10 v-96 z" fill={`url(#${g})`} stroke="#38bdf8" strokeWidth="2" />
      <rect x="78" y="96" width="44" height="30" fill="#0ea5e9" opacity="0.15" />
      <rect x="86" y="100" width="28" height="16" rx="2" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}

export function EnergyDrinkIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("energy");
  const sh = useGradId("energyShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#111827" />
          <stop offset="45%" stopColor="#1f2937" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#111827" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#111827" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="72" y="30" width="56" height="130" rx="10" fill={`url(#${g})`} />
      <ellipse cx="100" cy="30" rx="28" ry="8" fill="#e5e7eb" />
      <ellipse cx="100" cy="160" rx="28" ry="8" fill="#000000" opacity="0.5" />
      <path d="M104 60 l-18 30 h14 l-10 26 26 -34 h-14 z" fill="#facc15" />
      <circle cx="100" cy="24" r="6" fill="#9ca3af" />
    </svg>
  );
}

/* ------------------------------ Kitchen & Home --------------------------- */

export function MugIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("mug");
  const sh = useGradId("mugShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#064e3b" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#064e3b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="60" y="60" width="80" height="90" rx="10" fill={`url(#${g})`} />
      <ellipse cx="100" cy="60" rx="40" ry="10" fill="#d1fae5" />
      <path d="M140 78 q30 0 30 30 t-30 30" stroke="#059669" strokeWidth="10" fill="none" />
      <rect x="60" y="60" width="80" height="20" fill="#ffffff" opacity="0.25" />
    </svg>
  );
}

export function PlateIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("plate");
  const sh = useGradId("plateShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <radialGradient id={g} cx="40%" cy="35%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#e6f9f1" />
          <stop offset="100%" stopColor="#a7f3d0" />
        </radialGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#064e3b" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#064e3b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <ellipse cx="100" cy="100" rx="72" ry="46" fill={`url(#${g})`} />
      <ellipse cx="100" cy="100" rx="44" ry="28" fill="#059669" opacity="0.12" />
      <ellipse cx="100" cy="100" rx="44" ry="28" fill="none" stroke="#059669" strokeOpacity="0.3" strokeWidth="2" />
    </svg>
  );
}

export function BowlIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("bowl");
  const sh = useGradId("bowlShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#78350f" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#78350f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <path d="M40 100 a60 40 0 0 0 120 0 z" fill={`url(#${g})`} />
      <ellipse cx="100" cy="100" rx="60" ry="14" fill="#fef3c7" opacity="0.8" />
    </svg>
  );
}

export function CutleryIllustration({ className, ...rest }: IllustrationProps) {
  const sh = useGradId("cutleryShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id="cutG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e5e7eb" />
          <stop offset="100%" stopColor="#9ca3af" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#374151" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#374151" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <g fill="url(#cutG)">
        <rect x="60" y="30" width="8" height="130" rx="4" />
        <rect x="52" y="30" width="6" height="34" rx="3" />
        <rect x="62" y="30" width="6" height="34" rx="3" />
        <rect x="72" y="30" width="6" height="34" rx="3" />
        <rect x="96" y="30" width="10" height="140" rx="5" />
        <ellipse cx="101" cy="34" rx="14" ry="18" />
        <path d="M136 30 c14 0 20 18 8 40 l-4 10 v82 h-8 v-82 l-4 -10 c-12 -22 -6 -40 8 -40 z" />
      </g>
    </svg>
  );
}

/* -------------------------------- Kids Toys ------------------------------ */

export function ToyRobotIllustration({ className, ...rest }: IllustrationProps) {
  const sh = useGradId("robotShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#9d174d" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#9d174d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="70" y="30" width="12" height="18" rx="4" fill="#fb7185" />
      <circle cx="76" cy="26" r="6" fill="#fbbf24" />
      <rect x="58" y="48" width="84" height="60" rx="18" fill="#fb7185" />
      <rect x="72" y="62" width="22" height="16" rx="8" fill="#fff7ed" />
      <rect x="106" y="62" width="22" height="16" rx="8" fill="#fff7ed" />
      <circle cx="83" cy="70" r="5" fill="#1f2937" />
      <circle cx="117" cy="70" r="5" fill="#1f2937" />
      <rect x="86" y="88" width="28" height="6" rx="3" fill="#fff7ed" />
      <rect x="66" y="112" width="68" height="46" rx="14" fill="#fbbf24" />
      <circle cx="100" cy="134" r="12" fill="#fde68a" />
      <rect x="40" y="118" width="20" height="34" rx="10" fill="#fb7185" />
      <rect x="140" y="118" width="20" height="34" rx="10" fill="#fb7185" />
      <rect x="76" y="158" width="18" height="24" rx="8" fill="#f43f5e" />
      <rect x="106" y="158" width="18" height="24" rx="8" fill="#f43f5e" />
    </svg>
  );
}

export function ToyBlocksIllustration({ className, ...rest }: IllustrationProps) {
  const sh = useGradId("blocksShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#7c2d12" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="46" y="110" width="46" height="46" rx="8" fill="#fb7185" transform="rotate(-6 69 133)" />
      <rect x="104" y="104" width="50" height="50" rx="8" fill="#38bdf8" transform="rotate(5 129 129)" />
      <rect x="76" y="58" width="46" height="46" rx="8" fill="#fbbf24" transform="rotate(-3 99 81)" />
      <circle cx="69" cy="122" r="6" fill="#fecdd3" />
      <circle cx="129" cy="118" r="6" fill="#bae6fd" />
      <circle cx="99" cy="70" r="6" fill="#fde68a" />
    </svg>
  );
}

export function ToyCarIllustration({ className, ...rest }: IllustrationProps) {
  const sh = useGradId("carShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#7c2d12" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <path d="M36 128 q0 -20 22 -22 l14 -22 q6 -8 18 -8 h28 q12 0 18 8 l14 22 q22 2 22 22 v10 h-136 z" fill="#fbbf24" />
      <rect x="76" y="86" width="52" height="22" rx="6" fill="#fde68a" opacity="0.85" />
      <circle cx="70" cy="140" r="16" fill="#1f2937" />
      <circle cx="70" cy="140" r="6" fill="#e5e7eb" />
      <circle cx="132" cy="140" r="16" fill="#1f2937" />
      <circle cx="132" cy="140" r="6" fill="#e5e7eb" />
      <rect x="36" y="118" width="136" height="8" fill="#f59e0b" />
    </svg>
  );
}

export function GiftIllustration({ className, ...rest }: IllustrationProps) {
  const sh = useGradId("giftShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#5b21b6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#5b21b6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="52" y="86" width="96" height="76" rx="8" fill="#a855f7" />
      <rect x="52" y="86" width="96" height="20" fill="#7e22ce" />
      <rect x="92" y="86" width="16" height="76" fill="#fde047" />
      <path d="M100 86 c-30 -30 -50 -6 -30 6 c14 8 30 -2 30 -6z" fill="#fde047" />
      <path d="M100 86 c30 -30 50 -6 30 6 c-14 8 -30 -2 -30 -6z" fill="#fde047" />
    </svg>
  );
}

/* --------------------------------- Vape ---------------------------------- */

export function VapeDeviceIllustration({ className, ...rest }: IllustrationProps) {
  const g = useGradId("vape");
  const sh = useGradId("vapeShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <rect x="82" y="34" width="36" height="120" rx="10" fill={`url(#${g})`} />
      <rect x="88" y="26" width="24" height="14" rx="4" fill="#475569" />
      <rect x="88" y="70" width="24" height="10" rx="2" fill="#0f172a" opacity="0.3" />
    </svg>
  );
}

/* ------------------------------- Repairs --------------------------------- */

export function ToolsIllustration({ className, ...rest }: IllustrationProps) {
  const sh = useGradId("toolShadow");
  return (
    <svg viewBox="0 0 200 200" className={className} {...rest}>
      <defs>
        <radialGradient id={sh}>
          <stop offset="0%" stopColor="#7c2d12" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Shadow id={sh} />
      <g transform="rotate(20 100 100)">
        <rect x="94" y="30" width="12" height="90" rx="6" fill="#f97316" />
        <path d="M80 30 h40 l-8 -20 h-24 z" fill="#fdba74" />
      </g>
      <g transform="rotate(-25 100 100)">
        <rect x="94" y="90" width="12" height="70" rx="6" fill="#64748b" />
        <path d="M78 70 a22 22 0 0 1 44 0 v14 h-44 z" fill="#94a3b8" />
      </g>
    </svg>
  );
}

export const ILLUSTRATIONS = {
  phone: PhoneIllustration,
  tablet: TabletIllustration,
  tv: TVIllustration,
  case: CaseIllustration,
  charger: ChargerIllustration,
  cable: CableIllustration,
  headphones: HeadphoneIllustration,
  earbuds: EarbudsIllustration,
  powerbank: PowerbankIllustration,
  screenprotector: ScreenProtectorIllustration,
  holder: PhoneHolderIllustration,
  cola: ColaCanIllustration,
  colaDark: DarkColaCanIllustration,
  pepsi: PepsiCanIllustration,
  orangeSoda: OrangeCanIllustration,
  limeSoda: LimeCanIllustration,
  water: WaterBottleIllustration,
  energy: EnergyDrinkIllustration,
  mug: MugIllustration,
  plate: PlateIllustration,
  bowl: BowlIllustration,
  cutlery: CutleryIllustration,
  robot: ToyRobotIllustration,
  blocks: ToyBlocksIllustration,
  car: ToyCarIllustration,
  gift: GiftIllustration,
  vape: VapeDeviceIllustration,
  tools: ToolsIllustration,
} as const;

export type IllustrationKey = keyof typeof ILLUSTRATIONS;
