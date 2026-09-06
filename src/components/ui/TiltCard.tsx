import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "framer-motion";

const springConfig = { stiffness: 220, damping: 22, mass: 0.6 };

/**
 * Wraps a card with a subtle pointer-driven 3D tilt and a soft glare that
 * follows the cursor — the classic "premium product card" hover effect
 * (Stripe/Linear/Apple-style), implemented purely with CSS transforms so
 * it stays cheap and works alongside any existing card markup unchanged.
 *
 * Disabled for touch input and prefers-reduced-motion so it never gets in
 * the way on mobile or for users who've asked for less motion.
 */
export function TiltCard({
  children,
  className = "",
  radiusClassName = "rounded-3xl",
  maxTilt = 7,
  style,
}: {
  children: ReactNode;
  className?: string;
  radiusClassName?: string;
  maxTilt?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const glareOpacity = useSpring(0, springConfig);

  const rotateX = useSpring(useTransform(y, [0, 1], [maxTilt, -maxTilt]), springConfig);
  const rotateY = useSpring(useTransform(x, [0, 1], [-maxTilt, maxTilt]), springConfig);
  const glareX = useTransform(x, (v) => `${v * 100}%`);
  const glareY = useTransform(y, (v) => `${v * 100}%`);
  const glareBackground = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.4), transparent 60%)`;

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (reducedMotion || e.pointerType !== "mouse" || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width);
    y.set((e.clientY - rect.top) / rect.height);
    if (!active) setActive(true);
    glareOpacity.set(1);
  }

  function handlePointerLeave() {
    x.set(0.5);
    y.set(0.5);
    glareOpacity.set(0);
    setActive(false);
  }

  return (
    <div
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={className}
      style={{ perspective: 1000, ...style }}
    >
      <motion.div
        style={
          reducedMotion
            ? undefined
            : { rotateX, rotateY, transformStyle: "preserve-3d" }
        }
        className="relative h-full w-full"
      >
        {children}
        {!reducedMotion && (
          <motion.div
            aria-hidden
            className={`pointer-events-none absolute inset-0 ${radiusClassName} overflow-hidden`}
            style={{ opacity: glareOpacity, background: glareBackground }}
          />
        )}
      </motion.div>
    </div>
  );
}
