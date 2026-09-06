import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "./lib/cart-context";
import { Layout } from "./components/layout/Layout";
import Home from "./pages/Home";
import Shop from "./pages/Shop";
import Phones from "./pages/Phones";
import Accessories from "./pages/Accessories";
import Repairs from "./pages/Repairs";
import Drinks from "./pages/Drinks";
import Kitchen from "./pages/Kitchen";
import Toys from "./pages/Toys";
import Vape from "./pages/Vape";
import About from "./pages/About";
import Contact from "./pages/Contact";
import ProductDetail from "./pages/ProductDetail";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="shop" element={<Shop />} />
            <Route path="phones" element={<Phones />} />
            <Route path="accessories" element={<Accessories />} />
            <Route path="repairs" element={<Repairs />} />
            <Route path="drinks" element={<Drinks />} />
            <Route path="kitchen" element={<Kitchen />} />
            <Route path="toys" element={<Toys />} />
            <Route path="vape" element={<Vape />} />
            <Route path="about" element={<About />} />
            <Route path="contact" element={<Contact />} />
            <Route path="product/:slug" element={<ProductDetail />} />
            <Route path="cart" element={<Cart />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="terms" element={<Terms />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </CartProvider>
  );
}
