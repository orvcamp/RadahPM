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
  } finally {
    await pool.end();
  }
}

migrate();
