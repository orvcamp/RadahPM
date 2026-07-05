// backend/db/pool.js
// Central PostgreSQL connection pool. Reads DATABASE_URL from
// environment (set automatically by Railway/Render when you
// attach a Postgres service, or set manually in .env for local dev).

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn(
    "[radah-pm] WARNING: DATABASE_URL is not set. Set it in your .env file " +
      "or in your hosting provider's environment variables before starting the server."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most managed Postgres providers (Railway, Render, Supabase) require SSL
  // in production but not for local dev. This toggles based on NODE_ENV.
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("error", (err) => {
  console.error("[radah-pm] Unexpected error on idle database client", err);
});

module.exports = pool;
