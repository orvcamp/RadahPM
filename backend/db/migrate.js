// backend/db/migrate.js
// Runs schema.sql against the configured database.
// Usage: node db/migrate.js

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function runSqlFile(filename, label) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) return;
  const sql = fs.readFileSync(filePath, "utf8");
  console.log(`[radah-pm] Running ${label}...`);
  try {
    await pool.query(sql);
    console.log(`[radah-pm] ${label} complete.`);
  } catch (err) {
    // If types/tables already exist, that's fine on re-run — surface other errors.
    if (err.code === "42710" || err.code === "42P07") {
      console.log(`[radah-pm] ${label}: some objects already exist — skipping.`);
    } else {
      console.error(`[radah-pm] ${label} failed:`, err.message);
      process.exitCode = 1;
    }
  }
}

async function migrate() {
  try {
    await runSqlFile("schema.sql", "Phase 1 schema migration");
    await runSqlFile("migrations_phase2.sql", "Phase 2 migration (documents)");
    await runSqlFile("migrations_phase2_budgets.sql", "Phase 2 migration (budgets)");
    await runSqlFile("migrations_phase2_changeorders.sql", "Phase 2 migration (change orders)");
    await runSqlFile("migrations_phase2_dailylogs.sql", "Phase 2 migration (daily logs)");
    await runSqlFile("migrations_phase2_folders.sql", "Migration (document folders)");
    await runSqlFile("migrations_phase2_co_attachments.sql", "Migration (change order attachments)");
    await runSqlFile("migrations_phase3_orgs.sql", "Phase 3 migration (organizations / multi-tenancy)");
    await runSqlFile("migrations_phase3_modules.sql", "Phase 3 migration (org modules)");
    await runSqlFile("migrations_phase3_rfis.sql", "Migration (RFIs)");
  } finally {
    await pool.end();
  }
}

migrate();
