import { forwardRef } from "react";
import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.97]";

const variants = {
  primary:
    "bg-gradient-to-r from-brand-500 to-brand-700 text-white shadow-glow hover:shadow-[0_25px_70px_-15px_rgba(91,33,242,0.6)] hover:-translate-y-0.5",
  accent:
    "bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-[0_15px_40px_-12px_rgba(240,79,6,0.55)] hover:-translate-y-0.5 hover:shadow-[0_20px_55px_-12px_rgba(240,79,6,0.65)]",
  outline:
    "border-2 border-white/70 text-white hover:bg-white hover:text-brand-700",
  dark:
    "bg-ink-950 text-white hover:bg-ink-900 shadow-soft hover:-translate-y-0.5",
  ghost: "bg-white text-brand-700 border border-brand-100 hover:border-brand-300 hover:bg-brand-50",
  subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  white: "bg-white text-accent-700 hover:bg-accent-50 shadow-soft hover:-translate-y-0.5",
  whiteOnDark: "bg-white/10 text-white border border-white/20 hover:bg-white hover:text-brand-800",
};

const sizes = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-base",
  lg: "px-8 py-4 text-base md:text-lg",
};

type Variant = keyof typeof variants;
type Size = keyof typeof sizes;

interface CommonProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  className?: string;
  children?: ReactNode;
}

type ButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined; href?: undefined };
type ButtonAsLink = CommonProps & Omit<LinkProps, "className"> & { href?: undefined };
type ButtonAsAnchor = CommonProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & { to?: undefined; href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor;

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, iconRight, className = "", children, ...rest },
  ref
) {
  const cls = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

  if ("to" in rest && rest.to !== undefined) {
    const { to, ...linkRest } = rest as ButtonAsLink;
    return (
      <Link ref={ref as never} to={to} className={cls} {...linkRest}>
        {icon}
        {children}
        {iconRight}
      </Link>
    );
  }

  if ("href" in rest && rest.href !== undefined) {
    const { href, ...anchorRest } = rest as ButtonAsAnchor;
    return (
      <a ref={ref as never} href={href} className={cls} {...anchorRest}>
        {icon}
        {children}
        {iconRight}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button ref={ref as never} className={cls} {...buttonRest}>
      {icon}
      {children}
      {iconRight}
    </button>
  );
});
