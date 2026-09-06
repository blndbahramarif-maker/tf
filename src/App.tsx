import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { CartProvider } from "./lib/cart-context";
import { AdminAuthProvider } from "./lib/admin-auth-context";
import { Layout } from "./components/layout/Layout";
import { AdminLayout } from "./components/admin/AdminLayout";
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
import OrderConfirmation from "./pages/OrderConfirmation";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";
import AdminLogin from "./pages/admin/Login";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminProducts from "./pages/admin/Products";
import AdminProductForm from "./pages/admin/ProductForm";
import AdminOrders from "./pages/admin/Orders";
import AdminOrderDetail from "./pages/admin/OrderDetail";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <AdminAuthProvider>
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
                  <Route path="order-confirmation" element={<OrderConfirmation />} />
                  <Route path="privacy" element={<Privacy />} />
                  <Route path="terms" element={<Terms />} />
                  <Route path="*" element={<NotFound />} />
                </Route>

                <Route path="admin/login" element={<AdminLogin />} />
                <Route path="admin" element={<AdminLayout />}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="products" element={<AdminProducts />} />
                  <Route path="products/new" element={<AdminProductForm />} />
                  <Route path="products/:id/edit" element={<AdminProductForm />} />
                  <Route path="orders" element={<AdminOrders />} />
                  <Route path="orders/:id" element={<AdminOrderDetail />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </CartProvider>
        </AdminAuthProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
