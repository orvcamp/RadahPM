// backend/db/seed.js
// Creates the first admin user so you can log in after deployment.
// Usage: node db/seed.js
//
// Reads ADMIN_EMAIL and ADMIN_PASSWORD from environment if set,
// otherwise falls back to defaults below — CHANGE THE PASSWORD
// IMMEDIATELY after first login if you use the defaults.

require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./pool");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@radahpm.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe123!";
const ADMIN_NAME = process.env.ADMIN_NAME || "RADAH Admin";

async function seed() {
  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      ADMIN_EMAIL,
    ]);

    if (existing.rows.length > 0) {
      console.log(`[radah-pm] Admin user ${ADMIN_EMAIL} already exists. Skipping.`);
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, 'admin', TRUE)`,
      [ADMIN_EMAIL, passwordHash, ADMIN_NAME]
    );

    console.log("[radah-pm] Admin user created:");
    console.log(`  Email:    ${ADMIN_EMAIL}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
    console.log("  ⚠ Log in and change this password immediately.");
  } catch (err) {
    console.error("[radah-pm] Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
