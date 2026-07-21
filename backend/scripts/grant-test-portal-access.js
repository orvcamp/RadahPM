// backend/scripts/grant-test-portal-access.js
//
// Temporary convenience script — the staff-facing "grant portal access"
// screen doesn't exist yet (POST /api/properties/:id/portal-access does,
// this just calls the same logic directly against the DB so there's a way
// to try the owner portal frontend before that screen is built).
//
// Usage:
//   node scripts/grant-test-portal-access.js <email> <password> <propertyId>
//
// Finds-or-creates the portal_accounts row for that email (sets/resets the
// password either way, so this is also handy for resetting a test
// account's password), then grants it access to the given property.
// Prints the property's org automatically — no need to pass it separately.

require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");

async function main() {
  const [, , email, password, propertyId] = process.argv;
  if (!email || !password || !propertyId) {
    console.error("Usage: node scripts/grant-test-portal-access.js <email> <password> <propertyId>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const propertyRes = await pool.query("SELECT id, name, org_id FROM projects WHERE id = $1", [propertyId]);
  if (propertyRes.rows.length === 0) {
    console.error(`No property found with id ${propertyId}`);
    process.exit(1);
  }
  const property = propertyRes.rows[0];
  console.log(`[grant] Property: ${property.name} (org ${property.org_id})`);

  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await pool.query("SELECT id FROM portal_accounts WHERE email = $1", [normalizedEmail]);
  let portalAccountId;
  if (existing.rows.length > 0) {
    portalAccountId = existing.rows[0].id;
    await pool.query("UPDATE portal_accounts SET password_hash = $1, is_active = TRUE WHERE id = $2", [
      passwordHash,
      portalAccountId,
    ]);
    console.log(`[grant] Existing portal account found — password reset. (${portalAccountId})`);
  } else {
    const created = await pool.query(
      `INSERT INTO portal_accounts (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
      [normalizedEmail, passwordHash, "Test Owner"]
    );
    portalAccountId = created.rows[0].id;
    console.log(`[grant] New portal account created. (${portalAccountId})`);
  }

  const grant = await pool.query(
    `INSERT INTO portal_account_access (portal_account_id, org_id, project_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (portal_account_id, project_id) DO NOTHING
     RETURNING id`,
    [portalAccountId, property.org_id, property.id]
  );
  if (grant.rows.length > 0) {
    console.log("[grant] Access granted.");
  } else {
    console.log("[grant] Access already existed — nothing new to grant.");
  }

  console.log(`\n[grant] Done. Log in at /portal/login with:\n  email: ${normalizedEmail}\n  password: ${password}`);
  await pool.end();
}

main().catch((err) => {
  console.error("[grant] FAILED:", err.message);
  process.exitCode = 1;
  pool.end();
});
