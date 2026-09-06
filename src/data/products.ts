import type { IllustrationKey } from "../components/illustrations/Illustrations";
import type { CategorySlug } from "./categories";

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: CategorySlug;
  subcategory: string;
  price: number;
  oldPrice?: number;
  brand?: string;
  condition?: "New" | "Used" | "Refurbished";
  description: string;
  shortDescription: string;
  icon: IllustrationKey;
  badge?: string;
  featured?: boolean;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const raw: Omit<Product, "slug">[] = [
  // Phones & Technology
  {
    id: "ph-1",
    name: "iPhone 13 (Refurbished)",
    category: "phones",
    subcategory: "Smartphones",
    price: 329.99,
    oldPrice: 449.0,
    brand: "Apple",
    condition: "Refurbished",
    description:
      "Fully tested and refurbished iPhone 13 with a 90-day in-store warranty. Battery health checked, screen inspected and thoroughly cleaned. Comes unlocked and ready for any network.",
    shortDescription: "Unlocked, 90-day warranty, battery health checked.",
    icon: "phone",
    badge: "Best Seller",
    featured: true,
  },
  {
    id: "ph-2",
    name: "iPhone 14 Pro (Used – Excellent)",
    category: "phones",
    subcategory: "Smartphones",
    price: 549.99,
    brand: "Apple",
    condition: "Used",
    description:
      "Used iPhone 14 Pro in excellent condition with minimal signs of wear. Fully wiped, tested across all functions and unlocked to any network.",
    shortDescription: "Excellent condition, fully tested & unlocked.",
    icon: "phone",
    featured: true,
  },
  {
    id: "ph-3",
    name: "Samsung Galaxy S23",
    category: "phones",
    subcategory: "Smartphones",
    price: 599.99,
    brand: "Samsung",
    condition: "New",
    description:
      "Brand new, sealed Samsung Galaxy S23 with full manufacturer warranty. Stunning display, powerful camera and all-day battery life.",
    shortDescription: "Brand new & sealed, full manufacturer warranty.",
    icon: "phone",
  },
  {
    id: "ph-4",
    name: "Samsung Galaxy A54",
    category: "phones",
    subcategory: "Smartphones",
    price: 329.99,
    brand: "Samsung",
    condition: "New",
    description:
      "A brilliant mid-range smartphone with a smooth 120Hz display, great cameras and long battery life — brand new and sealed.",
    shortDescription: "Great value mid-range phone, brand new.",
    icon: "phone",
  },
  {
    id: "ph-5",
    name: "Google Pixel 8",
    category: "phones",
    subcategory: "Smartphones",
    price: 499.99,
    brand: "Google",
    condition: "New",
    description:
      "The latest Google Pixel with an outstanding camera, clean software experience and fast performance. Brand new and sealed.",
    shortDescription: "Class-leading camera, brand new and sealed.",
    icon: "phone",
  },
  {
    id: "ph-6",
    name: "iPhone SE (2022)",
    category: "phones",
    subcategory: "Smartphones",
    price: 199.99,
    brand: "Apple",
    condition: "Used",
    description:
      "A compact and affordable used iPhone SE, fully tested and wiped, perfect as a first phone or a reliable backup device.",
    shortDescription: "Compact, affordable, fully tested.",
    icon: "phone",
  },
  {
    id: "ph-7",
    name: "OnePlus Nord 3",
    category: "phones",
    subcategory: "Smartphones",
    price: 299.99,
    brand: "OnePlus",
    condition: "New",
    description:
      "Fast charging, a smooth 120Hz display and flagship-level performance at a mid-range price. Brand new and sealed.",
    shortDescription: "Flagship performance, fast charging, brand new.",
    icon: "phone",
  },
  {
    id: "ph-8",
    name: "iPad 10th Generation",
    category: "phones",
    subcategory: "Tablets & iPads",
    price: 389.99,
    brand: "Apple",
    condition: "New",
    description:
      "The latest entry-level iPad with a vivid Liquid Retina display, USB-C charging and plenty of power for work and play. Brand new and sealed.",
    shortDescription: "Latest model, brand new and sealed.",
    icon: "tablet",
    featured: true,
  },
  {
    id: "ph-9",
    name: "iPad Air (Refurbished)",
    category: "phones",
    subcategory: "Tablets & iPads",
    price: 449.99,
    brand: "Apple",
    condition: "Refurbished",
    description:
      "A professionally refurbished iPad Air with a 90-day warranty. Great for creative work, browsing and entertainment.",
    shortDescription: "Refurbished with 90-day warranty.",
    icon: "tablet",
  },
  {
    id: "ph-10",
    name: "Samsung Galaxy Tab A9",
    category: "phones",
    subcategory: "Tablets & iPads",
    price: 169.99,
    brand: "Samsung",
    condition: "New",
    description:
      "An affordable, brand new Android tablet that's perfect for streaming, browsing and everyday family use.",
    shortDescription: "Affordable family tablet, brand new.",
    icon: "tablet",
  },

  // Accessories
  {
    id: "ac-1",
    name: "Silicone Phone Case",
    category: "accessories",
    subcategory: "Cases",
    price: 9.99,
    description:
      "A soft-touch silicone case that protects your phone from everyday drops and scratches, available for most popular models.",
    shortDescription: "Soft-touch protection for most popular models.",
    icon: "case",
    featured: true,
  },
  {
    id: "ac-2",
    name: "Clear Shockproof Case",
    category: "accessories",
    subcategory: "Cases",
    price: 11.99,
    description:
      "Reinforced corners and a crystal-clear back let your phone's design shine through while staying protected from bumps and drops.",
    shortDescription: "Reinforced corners, crystal-clear design.",
    icon: "case",
  },
  {
    id: "ac-3",
    name: "20W Fast Charger Plug",
    category: "accessories",
    subcategory: "Chargers",
    price: 14.99,
    description:
      "A compact USB-C fast charging plug that tops your phone up quickly and safely, with built-in overcharge protection.",
    shortDescription: "Compact, fast and safe USB-C charging.",
    icon: "charger",
    featured: true,
  },
  {
    id: "ac-4",
    name: "Wireless Charging Pad",
    category: "accessories",
    subcategory: "Chargers",
    price: 19.99,
    description:
      "Simply place your Qi-compatible phone on the pad for effortless, cable-free charging at your desk or bedside.",
    shortDescription: "Effortless cable-free Qi charging.",
    icon: "charger",
  },
  {
    id: "ac-5",
    name: "USB-C to USB-C Cable (1m)",
    category: "accessories",
    subcategory: "Cables",
    price: 6.99,
    description: "A durable braided USB-C cable built to handle daily use without fraying.",
    shortDescription: "Durable braided cable, 1 metre.",
    icon: "cable",
  },
  {
    id: "ac-6",
    name: "Lightning Cable (1m)",
    category: "accessories",
    subcategory: "Cables",
    price: 7.99,
    description: "A reliable Lightning charging and data cable for iPhone and iPad.",
    shortDescription: "Reliable charge & sync cable for Apple devices.",
    icon: "cable",
  },
  {
    id: "ac-7",
    name: "Tempered Glass Screen Protector",
    category: "accessories",
    subcategory: "Screen Protectors",
    price: 4.99,
    description:
      "9H hardness tempered glass with a smooth, responsive touch feel and bubble-free fitting.",
    shortDescription: "9H hardness, bubble-free fitting.",
    icon: "screenprotector",
    featured: true,
  },
  {
    id: "ac-8",
    name: "Over-Ear Bluetooth Headphones",
    category: "accessories",
    subcategory: "Headphones",
    price: 34.99,
    description:
      "Comfortable over-ear headphones with rich sound, long battery life and a foldable design for travel.",
    shortDescription: "Rich sound, long battery, foldable design.",
    icon: "headphones",
  },
  {
    id: "ac-9",
    name: "True Wireless Earbuds",
    category: "accessories",
    subcategory: "Earphones",
    price: 27.99,
    description:
      "Compact true wireless earbuds with a pocket-friendly charging case and crisp, punchy audio.",
    shortDescription: "Compact, wireless & great sounding.",
    icon: "earbuds",
    featured: true,
  },
  {
    id: "ac-10",
    name: "10,000mAh Power Bank",
    category: "accessories",
    subcategory: "Power Banks",
    price: 22.99,
    description:
      "A slim, high-capacity power bank with dual outputs so you can keep your phone and accessories charged on the go.",
    shortDescription: "High capacity, dual output, slim design.",
    icon: "powerbank",
  },
  {
    id: "ac-11",
    name: "Car Phone Holder",
    category: "accessories",
    subcategory: "Phone Holders",
    price: 9.99,
    description: "A secure, adjustable car mount that keeps your phone in easy view while driving.",
    shortDescription: "Secure, adjustable car mount.",
    icon: "holder",
  },
  {
    id: "ac-12",
    name: "Desk Phone Stand",
    category: "accessories",
    subcategory: "Phone Holders",
    price: 8.99,
    description: "A sturdy aluminium stand that props your phone up at the perfect angle for calls and videos.",
    shortDescription: "Sturdy aluminium desk stand.",
    icon: "holder",
  },

  // Drinks — Fizzy
  { id: "dr-1", name: "Coca-Cola 330ml Can", category: "drinks", subcategory: "Fizzy Drinks", price: 1.1, description: "The original ice-cold classic, served straight from our fridge.", shortDescription: "Ice-cold classic cola.", icon: "cola" },
  { id: "dr-2", name: "Diet Coke 330ml Can", category: "drinks", subcategory: "Fizzy Drinks", price: 1.1, description: "All the classic taste with zero sugar.", shortDescription: "Classic taste, zero sugar.", icon: "colaDark" },
  { id: "dr-3", name: "Pepsi 330ml Can", category: "drinks", subcategory: "Fizzy Drinks", price: 1.05, description: "Bold, refreshing cola taste, ice-cold and ready to grab.", shortDescription: "Bold, refreshing cola taste.", icon: "pepsi" },
  { id: "dr-4", name: "Fanta Orange 330ml Can", category: "drinks", subcategory: "Fizzy Drinks", price: 1.05, description: "Fruity, fizzy orange refreshment.", shortDescription: "Fruity, fizzy orange refreshment.", icon: "orangeSoda" },
  { id: "dr-5", name: "Sprite 330ml Can", category: "drinks", subcategory: "Fizzy Drinks", price: 1.05, description: "Crisp, clear lemon-lime fizz.", shortDescription: "Crisp lemon-lime fizz.", icon: "limeSoda" },
  { id: "dr-6", name: "Still Water 500ml", category: "drinks", subcategory: "Water", price: 0.9, description: "Pure, refreshing still water, chilled and ready to go.", shortDescription: "Pure, chilled still water.", icon: "water", featured: true },
  { id: "dr-7", name: "Sparkling Water 500ml", category: "drinks", subcategory: "Water", price: 1.0, description: "Lightly carbonated spring water for a crisp, refreshing drink.", shortDescription: "Lightly carbonated spring water.", icon: "water" },
  { id: "dr-8", name: "Still Water 1.5L", category: "drinks", subcategory: "Water", price: 1.4, description: "A larger bottle of pure still water, perfect for sharing.", shortDescription: "Larger bottle, perfect for sharing.", icon: "water" },
  { id: "dr-9", name: "Red Bull 250ml", category: "drinks", subcategory: "Energy Drinks", price: 1.75, description: "The original energy drink to keep you going.", shortDescription: "The original energy drink.", icon: "energy", featured: true },
  { id: "dr-10", name: "Monster Energy 500ml", category: "drinks", subcategory: "Energy Drinks", price: 1.85, description: "A bold, full-flavoured energy drink in a big can.", shortDescription: "Bold, full-flavoured energy boost.", icon: "energy" },
  { id: "dr-11", name: "Relentless 500ml", category: "drinks", subcategory: "Energy Drinks", price: 1.65, description: "A great-tasting energy drink at a great price.", shortDescription: "Great taste, great price.", icon: "energy" },

  // Kitchen & Home
  { id: "kh-1", name: "Ceramic Dinner Plate Set", category: "kitchen", subcategory: "Tableware", price: 14.99, description: "A set of durable ceramic dinner plates with a clean, modern finish, dishwasher and microwave safe.", shortDescription: "Durable, dishwasher & microwave safe.", icon: "plate", featured: true },
  { id: "kh-2", name: "Soup Bowl Set (4pc)", category: "kitchen", subcategory: "Tableware", price: 11.99, description: "Four sturdy ceramic bowls, ideal for soups, cereal or pasta.", shortDescription: "Sturdy 4-piece ceramic bowl set.", icon: "bowl" },
  { id: "kh-3", name: "Stoneware Mug", category: "kitchen", subcategory: "Tableware", price: 5.99, description: "A generously sized stoneware mug for tea, coffee or hot chocolate.", shortDescription: "Generously sized stoneware mug.", icon: "mug" },
  { id: "kh-4", name: "Classic Coffee Mug (2 Pack)", category: "kitchen", subcategory: "Tableware", price: 8.99, description: "A pair of classic coffee mugs with a comfortable handle and smooth glaze.", shortDescription: "Classic 2-pack, comfortable handle.", icon: "mug" },
  { id: "kh-5", name: "Stainless Steel Cutlery Set (16pc)", category: "kitchen", subcategory: "Cutlery", price: 16.99, description: "A complete 16-piece stainless steel cutlery set covering forks, knives and spoons for a family of four.", shortDescription: "Complete 16-piece set for the family.", icon: "cutlery", featured: true },
  { id: "kh-6", name: "Kitchen Knife Set", category: "kitchen", subcategory: "Cutlery", price: 19.99, description: "A sharp, well-balanced knife set for everyday food preparation, including a storage block.", shortDescription: "Sharp, balanced, includes storage block.", icon: "cutlery" },
  { id: "kh-7", name: "Non-Stick Frying Pan", category: "kitchen", subcategory: "Kitchen Accessories", price: 17.99, description: "A durable non-stick frying pan that heats evenly for perfect everyday cooking.", shortDescription: "Even heating, durable non-stick coating.", icon: "bowl" },
  { id: "kh-8", name: "Storage Container Set", category: "kitchen", subcategory: "Kitchen Accessories", price: 12.99, description: "Stackable, airtight storage containers to keep your kitchen organised and food fresher for longer.", shortDescription: "Stackable, airtight & space saving.", icon: "bowl" },
  { id: "kh-9", name: "Kitchen Roll Holder", category: "kitchen", subcategory: "Home Essentials", price: 6.99, description: "A simple, sturdy stand that keeps kitchen roll tidy and within reach.", shortDescription: "Simple, sturdy and tidy.", icon: "mug" },
  { id: "kh-10", name: "Household Cleaning Caddy", category: "kitchen", subcategory: "Home Essentials", price: 9.99, description: "A handy caddy to keep your everyday cleaning essentials organised and easy to carry.", shortDescription: "Keeps cleaning essentials organised.", icon: "bowl" },

  // Kids' Toys
  { id: "ty-1", name: "Robot Toy", category: "toys", subcategory: "Fun Toys", price: 14.99, description: "A colourful, friendly robot toy with fun sound and light effects that kids will love.", shortDescription: "Colourful, fun lights & sounds.", icon: "robot", featured: true },
  { id: "ty-2", name: "Building Blocks Set (100pc)", category: "toys", subcategory: "Educational Toys", price: 16.99, description: "A 100-piece building block set that helps develop creativity and fine motor skills.", shortDescription: "100 pieces, builds creativity.", icon: "blocks" },
  { id: "ty-3", name: "Building Blocks Mega Set", category: "toys", subcategory: "Educational Toys", price: 29.99, description: "An extra-large block set with even more pieces for bigger builds and imaginative play.", shortDescription: "Extra-large set for big builds.", icon: "blocks" },
  { id: "ty-4", name: "Die-Cast Toy Car Set", category: "toys", subcategory: "Fun Toys", price: 9.99, description: "A set of durable die-cast toy cars in bright colours, great for little collectors.", shortDescription: "Durable, bright and collectable.", icon: "car" },
  { id: "ty-5", name: "Remote Control Car", category: "toys", subcategory: "Fun Toys", price: 24.99, description: "A fast and fun remote-controlled car, ready to race straight out of the box.", shortDescription: "Fast, fun, ready to race.", icon: "car", featured: true },
  { id: "ty-6", name: "Educational Puzzle Set", category: "toys", subcategory: "Educational Toys", price: 7.99, description: "A colourful jigsaw puzzle designed to build problem-solving skills while having fun.", shortDescription: "Builds problem-solving skills.", icon: "gift" },
  { id: "ty-7", name: "Mini Surprise Gift Box", category: "toys", subcategory: "Small Gifts", price: 4.99, description: "A fun little surprise gift box, perfect as a treat or party bag filler.", shortDescription: "A fun little surprise treat.", icon: "gift" },
  { id: "ty-8", name: "Cuddly Soft Toy", category: "toys", subcategory: "Small Gifts", price: 8.99, description: "A soft, huggable plush toy, perfect as a comforting gift for little ones.", shortDescription: "Soft, huggable and comforting.", icon: "gift" },

  // Vape (18+)
  { id: "vp-1", name: "Disposable Vape Device", category: "vape", subcategory: "Disposables", price: 5.99, description: "A single-use vape device. For adult smokers aged 18+ only. Please vape responsibly.", shortDescription: "Single-use device. 18+ only.", icon: "vape" },
  { id: "vp-2", name: "Vape Pod Kit", category: "vape", subcategory: "Devices", price: 14.99, description: "A refillable pod starter kit. For adult smokers aged 18+ only. Please vape responsibly.", shortDescription: "Refillable starter kit. 18+ only.", icon: "vape" },
  { id: "vp-3", name: "E-Liquid 10ml", category: "vape", subcategory: "E-Liquids", price: 3.99, description: "10ml nicotine e-liquid. For adult smokers aged 18+ only. Please vape responsibly.", shortDescription: "10ml e-liquid. 18+ only.", icon: "vape" },
  { id: "vp-4", name: "Replacement Coils (Pack of 5)", category: "vape", subcategory: "Accessories", price: 6.99, description: "Replacement coils compatible with popular pod kits. For adult smokers aged 18+ only.", shortDescription: "Pack of 5 replacement coils. 18+ only.", icon: "vape" },
];

export const products: Product[] = raw.map((p) => ({ ...p, slug: slugify(p.name) }));

export function getProductsByCategory(category: CategorySlug) {
  return products.filter((p) => p.category === category);
}

export function getProduct(slug: string) {
  return products.find((p) => p.slug === slug);
}

export function searchProducts(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.subcategory.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q)
  );
}
