import jwt from "jsonwebtoken";
import { findAdminById } from "./models/admins.js";

const DEFAULT_DEV_SECRET = "dgn-dev-secret-change-me";

export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;

if (JWT_SECRET === DEFAULT_DEV_SECRET) {
  console.warn(
    "[auth] WARNING: JWT_SECRET is not set. Using an insecure default — set JWT_SECRET in your environment before deploying to production."
  );
}

export function signAdminToken(admin) {
  return jwt.sign({ sub: admin.id, email: admin.email }, JWT_SECRET, {
    expiresIn: "12h",
  });
}

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const admin = findAdminById(payload.sub);
    if (!admin) {
      return res.status(401).json({ error: "Invalid session." });
    }
    req.admin = { id: admin.id, email: admin.email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}
