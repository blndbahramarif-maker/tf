import type { IllustrationKey } from "../components/illustrations/Illustrations";

export type CategorySlug =
  | "phones"
  | "accessories"
  | "repairs"
  | "drinks"
  | "kitchen"
  | "toys"
  | "vape";

export interface Category {
  slug: CategorySlug;
  name: string;
  shortName: string;
  tagline: string;
  blurb: string;
  href: string;
  icon: IllustrationKey;
  /** Tailwind gradient classes used for cards/badges themed to this category */
  gradient: string;
  softBg: string;
  textAccent: string;
  ageRestricted?: boolean;
}

export const categories: Category[] = [
  {
    slug: "phones",
    name: "Phones & Technology",
    shortName: "Phones",
    tagline: "New, used & refurbished",
    blurb:
      "Smartphones, tablets, iPads and technology — new, used and refurbished, all tested and ready to go.",
    href: "/phones",
    icon: "phone",
    gradient: "from-brand-500 to-brand-800",
    softBg: "bg-brand-50",
    textAccent: "text-brand-600",
  },
  {
    slug: "accessories",
    name: "Phone Accessories",
    shortName: "Accessories",
    tagline: "Cases, chargers & more",
    blurb:
      "Cases, chargers, cables, screen protectors, headphones, earbuds and power banks for every device.",
    href: "/accessories",
    icon: "case",
    gradient: "from-accent-400 to-accent-700",
    softBg: "bg-accent-50",
    textAccent: "text-accent-600",
  },
  {
    slug: "repairs",
    name: "Repairs",
    shortName: "Repairs",
    tagline: "Same-day & next-day",
    blurb:
      "Expert phone, iPad, tablet and TV repairs — with same-day and next-day turnaround available.",
    href: "/repairs",
    icon: "tools",
    gradient: "from-rose-500 to-orange-600",
    softBg: "bg-rose-50",
    textAccent: "text-rose-600",
  },
  {
    slug: "drinks",
    name: "Drinks",
    shortName: "Drinks",
    tagline: "Fizzy, water & energy",
    blurb: "Ice-cold fizzy drinks, still & sparkling water and energy drinks.",
    href: "/drinks",
    icon: "cola",
    gradient: "from-teal-400 to-teal-600",
    softBg: "bg-teal-50",
    textAccent: "text-teal-600",
  },
  {
    slug: "kitchen",
    name: "Kitchen & Home",
    shortName: "Kitchen & Home",
    tagline: "Tableware & essentials",
    blurb: "Cups, plates, bowls, cutlery and everyday household essentials.",
    href: "/kitchen",
    icon: "plate",
    gradient: "from-emerald-400 to-emerald-600",
    softBg: "bg-emerald-50",
    textAccent: "text-emerald-600",
  },
  {
    slug: "toys",
    name: "Kids' Toys",
    shortName: "Kids' Toys",
    tagline: "Fun for all ages",
    blurb: "Small toys, educational fun and lovely little gifts for children.",
    href: "/toys",
    icon: "robot",
    gradient: "from-pink-400 via-fuchsia-400 to-amber-400",
    softBg: "bg-pink-50",
    textAccent: "text-pink-600",
  },
  {
    slug: "vape",
    name: "Vape Products",
    shortName: "Vape 18+",
    tagline: "Age restricted — 18+",
    blurb: "Vaping products for adult customers only. Age verification required.",
    href: "/vape",
    icon: "vape",
    gradient: "from-slate-600 to-slate-800",
    softBg: "bg-slate-100",
    textAccent: "text-slate-700",
    ageRestricted: true,
  },
];

export function getCategory(slug: string) {
  return categories.find((c) => c.slug === slug);
}
