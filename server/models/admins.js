import bcrypt from "bcryptjs";
import { db } from "../db.js";

export function findAdminByEmail(email) {
  return db
    .prepare("SELECT * FROM admins WHERE email = ?")
    .get(String(email).toLowerCase());
}

export function findAdminById(id) {
  return db.prepare("SELECT * FROM admins WHERE id = ?").get(id);
}

export function createAdmin(email, password) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO admins (email, password_hash) VALUES (?, ?)")
    .run(String(email).toLowerCase(), passwordHash);
  return findAdminById(info.lastInsertRowid);
}

export function verifyPassword(admin, password) {
  return bcrypt.compareSync(password, admin.password_hash);
}

export function updateAdminPassword(id, newPassword) {
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE admins SET password_hash = ? WHERE id = ?").run(
    passwordHash,
    id
  );
}

export function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM admins").get().n;
}
