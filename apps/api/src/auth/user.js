import bcrypt from "bcrypt";
import fs from "node:fs";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_HASH_FILE = process.env.ADMIN_PASSWORD_HASH_FILE || "";
let ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const NODE_ENV = process.env.NODE_ENV || "";

if (NODE_ENV === "production" && ADMIN_PASSWORD_HASH_FILE && !ADMIN_PASSWORD_HASH) {
  try {
    ADMIN_PASSWORD_HASH = fs
      .readFileSync(ADMIN_PASSWORD_HASH_FILE, "utf8")
      .trim();
  } catch (err) {
    console.warn(
      `ADMIN_PASSWORD_HASH_FILE could not be read: ${ADMIN_PASSWORD_HASH_FILE}`
    );
  }
}

export const AUTH_USER = {
  id: "user-1",
  username: ADMIN_USERNAME,
};

export async function validateCredentials({ username, password }) {
  if (!username || !password) return false;
  if (username !== ADMIN_USERNAME) return false;
  if (ADMIN_PASSWORD_HASH) {
    const isValid = Boolean(
      await bcrypt.compare(password, ADMIN_PASSWORD_HASH)
    );
    if (!isValid) {
      console.warn("Invalid credentials: password hash mismatch");
    }
    return isValid;
  }
  if (ADMIN_PASSWORD) {
    console.log("AUTH validateCredentials using ADMIN_PASSWORD");
    const isValid = password === ADMIN_PASSWORD;
    if (!isValid) {
      console.warn("Invalid credentials: password mismatch");
    }
    return isValid;
  }
  console.warn("Invalid credentials: no password configured");
  return false;
}
