import type { Order, Product, ProductInput } from "../types/product";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : undefined;

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

/* ------------------------------- Public API ------------------------------ */

export function fetchProducts(): Promise<Product[]> {
  return request<{ products: Product[] }>("/products").then((r) => r.products);
}

export function fetchProductBySlug(slug: string): Promise<Product> {
  return request<{ product: Product }>(`/products/${slug}`).then((r) => r.product);
}

export interface PlaceOrderPayload {
  customerName: string;
  phone: string;
  email: string;
  fulfilmentType: "collection" | "delivery";
  address?: string;
  items: { productId: number; quantity: number; color?: string; storage?: string }[];
}

export function placeOrder(payload: PlaceOrderPayload): Promise<Order> {
  return request<{ order: Order }>("/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((r) => r.order);
}

export function createCheckoutSession(orderId: number): Promise<{ url: string }> {
  return request<{ url: string }>(`/orders/${orderId}/checkout-session`, {
    method: "POST",
  });
}

export function fetchOrderBySession(sessionId: string): Promise<Order> {
  return request<{ order: Order }>(`/orders/session/${sessionId}`).then((r) => r.order);
}

/* -------------------------------- Admin API -------------------------------- */

export interface AdminSession {
  token: string;
  admin: { id: number; email: string };
}

export function adminLogin(email: string, password: string): Promise<AdminSession> {
  return request<AdminSession>("/admin/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function adminMe(token: string): Promise<AdminSession["admin"]> {
  return request<{ admin: AdminSession["admin"] }>("/admin/me", { token }).then(
    (r) => r.admin
  );
}

export function adminListProducts(token: string): Promise<Product[]> {
  return request<{ products: Product[] }>("/admin/products", { token }).then(
    (r) => r.products
  );
}

export function adminGetProduct(token: string, id: number): Promise<Product> {
  return request<{ product: Product }>(`/admin/products/${id}`, { token }).then(
    (r) => r.product
  );
}

export function adminCreateProduct(token: string, input: ProductInput): Promise<Product> {
  return request<{ product: Product }>("/admin/products", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  }).then((r) => r.product);
}

export function adminUpdateProduct(
  token: string,
  id: number,
  input: Partial<ProductInput>
): Promise<Product> {
  return request<{ product: Product }>(`/admin/products/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(input),
  }).then((r) => r.product);
}

export function adminDeleteProduct(token: string, id: number): Promise<void> {
  return request<void>(`/admin/products/${id}`, { method: "DELETE", token });
}

export async function adminUploadImage(token: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch("/api/admin/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data?.error || "Upload failed", res.status);
  return data.url as string;
}

export function adminListOrders(token: string): Promise<Order[]> {
  return request<{ orders: Order[] }>("/admin/orders", { token }).then((r) => r.orders);
}

export function adminGetOrder(token: string, id: number): Promise<Order> {
  return request<{ order: Order }>(`/admin/orders/${id}`, { token }).then((r) => r.order);
}

export function adminUpdateOrderStatus(
  token: string,
  id: number,
  status: Order["status"]
): Promise<Order> {
  return request<{ order: Order }>(`/admin/orders/${id}/status`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ status }),
  }).then((r) => r.order);
}

export function adminRefundOrder(token: string, id: number): Promise<Order> {
  return request<{ order: Order }>(`/admin/orders/${id}/refund`, {
    method: "POST",
    token,
  }).then((r) => r.order);
}
