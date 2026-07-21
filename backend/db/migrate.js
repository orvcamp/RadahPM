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
    await runSqlFile("migrations_phase3_submittals.sql", "Migration (Submittals)");
    await runSqlFile("migrations_phase3_password_reset.sql", "Migration (password reset)");
    await runSqlFile("migrations_phase3_project_photo.sql", "Migration (project photo)");
    await runSqlFile("migrations_phase3_project_stage.sql", "Migration (project stage)");
    await runSqlFile("migrations_phase3_schedule_files.sql", "Migration (schedule files)");
    await runSqlFile("migrations_phase3_soft_delete.sql", "Migration (soft delete / recycle bin)");
    await runSqlFile("migrations_phase3_dailylog_expanded.sql", "Migration (expanded daily log)");
    await runSqlFile("migrations_phase3_token_version.sql", "Migration (session revocation)");
    await runSqlFile("migrations_phase3_notifications.sql", "Migration (notifications)");
    await runSqlFile("migrations_phase3_logs.sql", "Migration (project logs)");
    await runSqlFile("migrations_phase3_budget_estimate.sql", "Migration (estimate fields on budget lines)");
    await runSqlFile("migrations_phase3_schedule_activities.sql", "Migration (schedule activities)");
    await runSqlFile("migrations_phase4_billing.sql", "Migration (billing / pay applications)");
    await runSqlFile("migrations_phase4_billing_pdf.sql", "Migration (billing PDF filing link)");
    await runSqlFile("migrations_phase4_folder_reorder.sql", "Migration (rename folder template for reorder)");
    await runSqlFile("migrations_phase4_folder_dedupe.sql", "Migration (dedupe folders + prevent recurrence)");
    await runSqlFile("migrations_phase5_platform_core.sql", "Phase 5 migration (multi-vertical core: org vertical, folder templates, workflow statuses)");
    await runSqlFile("migrations_phase6_facilities.sql", "Phase 6 migration (MangoDoe Facilities: properties, assets, work orders, PM schedules, vendors, inspections)");
    await runSqlFile("migrations_phase7_projects.sql", "Phase 7 migration (MangoDoe Projects: time entries, approval requests, folder template)");
  await runSqlFile("migrations_phase8_audit.sql", "Phase 8 migration (audit log)");
  await runSqlFile("migrations_phase9_pm_assignee.sql", "Phase 9 migration (PM schedule default assignee)");
  await runSqlFile("migrations_phase10_portal_accounts.sql", "Phase 10 migration (Property Owner Portal accounts)");
  await runSqlFile("migrations_phase10_protect_memberships.sql", "Phase 10 migration (Radah Protect memberships)");
  await runSqlFile("migrations_phase10_portal_service_requests.sql", "Phase 10 migration (portal-originated service requests)");
  } finally {
    await pool.end();
  }
}

migrate();
