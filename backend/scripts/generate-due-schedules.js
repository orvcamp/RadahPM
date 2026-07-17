// backend/scripts/generate-due-schedules.js
//
// Railway Cron Job entry point — runs once daily. Scans all active,
// non-deleted pm_schedules where next_due_date <= today, and generates a
// work_order for each via the same logic the manual "Generate Now" button
// uses (backend/routes/workorders.js: generatePmScheduleWorkOrder).
//
// Not an HTTP route — invoked directly as a one-off process by Railway's
// Cron Job scheduler (node backend/scripts/generate-due-schedules.js),
// then exits. Logs a summary and exits non-zero on any failure so Railway
// surfaces a failed cron run clearly.

const pool = require("../db/pool");
const { generatePmScheduleWorkOrder } = require("../routes/workorders");

async function run() {
  console.log(`[radah-pm] generate-due-schedules starting at ${new Date().toISOString()}`);

  let due;
  try {
    due = await pool.query(
      "SELECT id, title FROM pm_schedules WHERE is_active = TRUE AND deleted_at IS NULL AND next_due_date <= CURRENT_DATE"
    );
  } catch (err) {
    console.error("[radah-pm] generate-due-schedules: failed to query due schedules:", err);
    process.exit(1);
  }

  console.log(`[radah-pm] generate-due-schedules: found ${due.rows.length} due schedule(s).`);

  let succeeded = 0;
  let failed = 0;

  for (const row of due.rows) {
    try {
      const result = await generatePmScheduleWorkOrder(row.id, null);
      if (result.notFound) {
        console.error(`[radah-pm] generate-due-schedules: schedule ${row.id} ("${row.title}") not found at generate time — skipped.`);
        failed++;
        continue;
      }
      console.log(`[radah-pm] generate-due-schedules: generated work order ${result.workOrder.id} from schedule ${row.id} ("${row.title}").`);
      succeeded++;
    } catch (err) {
      console.error(`[radah-pm] generate-due-schedules: failed on schedule ${row.id} ("${row.title}"):`, err);
      failed++;
    }
  }

  console.log(`[radah-pm] generate-due-schedules complete: ${succeeded} succeeded, ${failed} failed.`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run();
