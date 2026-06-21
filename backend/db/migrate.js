// backend/db/migrate.js
// Runs schema.sql against the configured database.
// Usage: node db/migrate.js

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  console.log("[radah-pm] Running schema migration...");
  try {
    await pool.query(schemaSql);
    console.log("[radah-pm] Schema migration complete.");
  } catch (err) {
    // If types/tables already exist, that's fine on re-run — surface other errors.
    if (err.code === "42710" || err.code === "42P07") {
      console.log(
        "[radah-pm] Some objects already exist — schema appears to be already migrated."
      );
    } else {
      console.error("[radah-pm] Migration failed:", err.message);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

migrate();
