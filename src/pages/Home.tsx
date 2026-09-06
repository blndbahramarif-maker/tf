import { Hero } from "../components/home/Hero";
import { RepairBanner } from "../components/home/RepairBanner";
import { ServicesSection } from "../components/home/ServicesSection";
import { CategoriesSection } from "../components/home/CategoriesSection";
import { FeaturedProducts } from "../components/home/FeaturedProducts";
import { WhyChooseUs } from "../components/home/WhyChooseUs";
import { ContactSection } from "../components/home/ContactSection";
import { usePageMeta } from "../lib/usePageMeta";

export default function Home() {
  usePageMeta(
    "Everything You Need, All in One Shop",
    "DGN Tech Mobiles, Purley — buy & sell phones, same-day phone/iPad/tablet/TV repairs, accessories, drinks, kitchen essentials and kids' toys."
  );
  return (
    <>
      <Hero />
      <RepairBanner />
      <ServicesSection />
      <CategoriesSection />
      <FeaturedProducts />
      <WhyChooseUs />
      <ContactSection />
    </>
  );
}
