// backend/notifyExternal.js
//
// Email/SMS notifications for work order assignment — separate from
// notify.js (in-app only), since vendors have no user account/login and
// can only be reached this way. Same design rule as notify.js: a
// notification failure must NEVER break the action that triggered it.
// Every call here is wrapped and failures are logged, not thrown.
//
// Email: reuses the existing backend/mail.js (Resend via REST API, already
// used by auth.js/dailylogs.js/reports.js — RESEND_API_KEY + MAIL_FROM env
// vars). Does NOT use the Resend SDK.
// SMS: scaffolded but inactive until Twilio credentials are added
// (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER). If those
// aren't set, sendAssignmentSms logs and returns — no twilio package is
// required yet, so this doesn't block deploys before Twilio is set up.

const pool = require("./db/pool");
const mail = require("./mail");

async function sendAssignmentEmail(to, subject, html) {
  if (!mail.isConfigured) {
    console.log("[radah-pm] notifyExternal: mail is not configured, skipping email to", to);
    return;
  }
  try {
    await mail.send({ to: [to], subject, html });
    console.log("[radah-pm] notifyExternal: email sent to", to);
  } catch (err) {
    console.error("[radah-pm] notifyExternal: email send failed:", err.message);
  }
}

// Scaffolded, inactive until Twilio credentials exist. Deliberately does not
// require("twilio") at module load time — that package isn't installed yet,
// and this function should be a safe no-op until it is.
async function sendAssignmentSms(to, body) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log("[radah-pm] notifyExternal: Twilio not configured, skipping SMS to", to);
    return;
  }
  try {
    const twilio = require("twilio");
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    await client.messages.create({ to, from: TWILIO_PHONE_NUMBER, body });
    console.log("[radah-pm] notifyExternal: SMS sent to", to);
  } catch (err) {
    console.error("[radah-pm] notifyExternal: SMS send failed:", err.message);
  }
}

/**
 * Notify a work order's assignee (user or vendor) by email/SMS that they've
 * been assigned. Never throws — wraps the whole thing so a notification
 * failure can never break the assignment action that triggered it.
 *
 * @param {object} opts
 * @param {object} opts.workOrder      - the work order row (snake_case, straight from the DB)
 * @param {'user'|'vendor'|null} opts.assigneeType
 * @param {string|null} opts.assigneeId
 */
async function notifyAssigneeExternal({ workOrder, assigneeType, assigneeId }) {
  if (!assigneeType || !assigneeId) return;

  try {
    let name, email, phone;
    if (assigneeType === "user") {
      const r = await pool.query("SELECT full_name, email, phone FROM users WHERE id = $1", [assigneeId]);
      if (!r.rows[0]) return;
      name = r.rows[0].full_name; email = r.rows[0].email; phone = r.rows[0].phone;
    } else {
      const r = await pool.query("SELECT name, email, phone FROM vendors WHERE id = $1", [assigneeId]);
      if (!r.rows[0]) return;
      name = r.rows[0].name; email = r.rows[0].email; phone = r.rows[0].phone;
    }

    const subject = `You've been assigned: ${workOrder.title}`;
    const safeName = mail.escapeHtml(name || "there");
    const safeTitle = mail.escapeHtml(workOrder.title);
    const safeDesc = workOrder.description ? mail.escapeHtml(workOrder.description) : "";
    const html = `
      <div style="font-family:sans-serif;font-size:14px;color:#111;">
        <p>Hi ${safeName},</p>
        <p>You've been assigned a work order: <strong>${safeTitle}</strong></p>
        ${safeDesc ? `<p>${safeDesc}</p>` : ""}
        ${workOrder.scheduled_date ? `<p>Scheduled: ${mail.escapeHtml(String(workOrder.scheduled_date))}</p>` : ""}
        <p style="color:#6b7280;">— MangoDoe Facilities</p>
      </div>`;
    const smsText = `You've been assigned a work order: "${workOrder.title}". — MangoDoe Facilities`;

    if (email) await sendAssignmentEmail(email, subject, html);
    if (phone) await sendAssignmentSms(phone, smsText);
  } catch (err) {
    console.error("[radah-pm] notifyAssigneeExternal failed:", err.message);
  }
}

module.exports = { notifyAssigneeExternal };
