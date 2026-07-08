// backend/notify.js
//
// In-app notifications. One row per recipient per event.
//
// Design rules:
//   - Notifying must NEVER break the action that triggered it. Every call is
//     wrapped and failures are logged, not thrown.
//   - The actor is never notified of their own action.
//   - Recipients are the project's members plus the organization's internal
//     users (admin/staff), who have visibility into every project in their org.
//   - Roles that cannot see a module are excluded from its events (a trade
//     partner has no access to change orders, so they get no CO notifications).
//   - Actor and project names are stored on the row, so the bell renders with
//     no joins and still reads correctly if the source record is later deleted.

const pool = require("./db/pool");

/**
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.orgId
 * @param {string} opts.actorId       - the user who performed the action
 * @param {string} opts.actorName
 * @param {string} opts.type          - e.g. "rfi.raised"
 * @param {string} opts.title         - short headline
 * @param {string} [opts.body]        - one line of detail
 * @param {string} [opts.tab]         - project tab to open (documents, rfis, ...)
 * @param {string[]} [opts.excludeRoles] - platform roles that shouldn't be told
 */
async function notifyProject(opts) {
  const { projectId, orgId, actorId, actorName, type, title, body = null, tab = null, excludeRoles = [] } = opts || {};
  if (!projectId || !orgId || !type || !title) return;

  try {
    const proj = await pool.query("SELECT name FROM projects WHERE id = $1", [projectId]);
    const projectName = proj.rows[0] ? proj.rows[0].name : null;

    // Members of the project, plus internal users of the same org.
    const recipients = await pool.query(
      `SELECT DISTINCT u.id, u.role
         FROM users u
        WHERE u.org_id = $1
          AND u.is_active = TRUE
          AND u.id <> $2
          AND (
                EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $3 AND pm.user_id = u.id)
             OR u.role IN ('admin', 'staff')
          )`,
      [orgId, actorId || "00000000-0000-0000-0000-000000000000", projectId]
    );

    const targets = recipients.rows.filter((r) => !excludeRoles.includes(r.role));
    if (targets.length === 0) return;

    // Single multi-row insert.
    const values = [];
    const params = [];
    let i = 1;
    for (const t of targets) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(t.id, orgId, projectId, projectName, type, title, body, tab, actorName || null);
    }
    await pool.query(
      `INSERT INTO notifications (user_id, org_id, project_id, project_name, type, title, body, tab, actor_name)
       VALUES ${values.join(", ")}`,
      params
    );
  } catch (err) {
    // Deliberately swallowed: a notification failure must not fail the action.
    console.error("[radah-pm] notify failed:", err.message);
  }
}

module.exports = { notifyProject };
