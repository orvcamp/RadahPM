// backend/scripts/verify-phase10.js
// Confirms the Phase 10 tables (portal_accounts, portal_account_access,
// protect_tiers, protect_memberships) exist and actually work end-to-end —
// not just that the migration ran without erroring.
//
// Creates real throwaway rows, exercises the relationships a route would
// rely on, then cleans up. Safe to re-run.
//
// Usage: node scripts/verify-phase10.js

require("dotenv").config();
const pool = require("../db/pool");

async function main() {
  console.log("[verify] Starting Phase 10 verification...\n");

  // ---- 0. Find a real org + a real property (projects row) to attach to.
  const orgRes = await pool.query("SELECT id, name FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (orgRes.rows.length === 0) throw new Error("No organizations found — can't verify against real data.");
  const org = orgRes.rows[0];
  console.log(`[verify] Using org: ${org.name} (${org.id})`);

  const propertyRes = await pool.query(
    "SELECT id, name FROM projects WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1",
    [org.id]
  );
  if (propertyRes.rows.length === 0) throw new Error("No projects/properties found for this org — can't verify against real data.");
  const property = propertyRes.rows[0];
  console.log(`[verify] Using property: ${property.name} (${property.id})\n`);

  let portalAccountId, accessId, tierId, membershipId;

  try {
    // ---- 1. portal_accounts ----
    const testEmail = `verify-phase10-${Date.now()}@example.com`;
    const paRes = await pool.query(
      `INSERT INTO portal_accounts (email, password_hash, full_name)
       VALUES ($1, 'not-a-real-hash', 'Phase 10 Verify Test') RETURNING id, email`,
      [testEmail]
    );
    portalAccountId = paRes.rows[0].id;
    console.log(`[verify] ✓ portal_accounts insert OK (${paRes.rows[0].email})`);

    // ---- 2. portal_account_access ----
    const accessRes = await pool.query(
      `INSERT INTO portal_account_access (portal_account_id, org_id, project_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [portalAccountId, org.id, property.id]
    );
    accessId = accessRes.rows[0].id;
    console.log("[verify] ✓ portal_account_access insert OK");

    // ---- 3. Resolve properties visible to this portal login (same query as GET /api/portal/properties) ----
    const visibleRes = await pool.query(
      `SELECT p.id, p.name, o.name AS org_name
       FROM portal_account_access a
       JOIN projects p ON p.id = a.project_id
       JOIN organizations o ON o.id = a.org_id
       WHERE a.portal_account_id = $1`,
      [portalAccountId]
    );
    if (visibleRes.rows.length !== 1 || visibleRes.rows[0].id !== property.id) {
      throw new Error("Portal account access resolution did not return the expected property.");
    }
    console.log(`[verify] ✓ portal login correctly resolves to: ${visibleRes.rows[0].name} (org: ${visibleRes.rows[0].org_name})`);

    // ---- 4. protect_tiers ----
    const tierRes = await pool.query(
      `INSERT INTO protect_tiers (org_id, name, discount_percent)
       VALUES ($1, 'Verify Test Tier', 15.00) RETURNING id, discount_percent`,
      [org.id]
    );
    tierId = tierRes.rows[0].id;
    console.log(`[verify] ✓ protect_tiers insert OK (${tierRes.rows[0].discount_percent}% discount)`);

    // ---- 5. protect_memberships (property-scoped) ----
    const membershipRes = await pool.query(
      `INSERT INTO protect_memberships (org_id, scope_type, scope_id, tier_id)
       VALUES ($1, 'property', $2, $3) RETURNING id, scope_type, billing_model, status`,
      [org.id, property.id, tierId]
    );
    membershipId = membershipRes.rows[0].id;
    console.log(
      `[verify] ✓ protect_memberships insert OK (scope=${membershipRes.rows[0].scope_type}, ` +
        `billing_model=${membershipRes.rows[0].billing_model}, status=${membershipRes.rows[0].status})`
    );

    // ---- 6. Resolve the discount for this property (same query as GET /api/properties/:id/protect-discount) ----
    const discountRes = await pool.query(
      `SELECT m.*, t.discount_percent FROM protect_memberships m
       LEFT JOIN protect_tiers t ON t.id = m.tier_id
       WHERE m.scope_type = 'property' AND m.scope_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1`,
      [property.id]
    );
    if (discountRes.rows.length !== 1 || Number(discountRes.rows[0].discount_percent) !== 15) {
      throw new Error("Discount resolution did not return the expected 15% tier discount.");
    }
    console.log(`[verify] ✓ discount resolution correctly returns ${discountRes.rows[0].discount_percent}%\n`);

    console.log("[verify] ALL CHECKS PASSED ✓\n");
  } finally {
    // ---- Cleanup — always runs, even if a check failed above ----
    console.log("[verify] Cleaning up test data...");
    if (membershipId) await pool.query("DELETE FROM protect_memberships WHERE id = $1", [membershipId]);
    if (tierId) await pool.query("DELETE FROM protect_tiers WHERE id = $1", [tierId]);
    if (accessId) await pool.query("DELETE FROM portal_account_access WHERE id = $1", [accessId]);
    if (portalAccountId) await pool.query("DELETE FROM portal_accounts WHERE id = $1", [portalAccountId]);
    console.log("[verify] Cleanup complete.");
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\n[verify] FAILED:", err.message);
  process.exitCode = 1;
  pool.end();
});
