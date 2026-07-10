// backend/mail.js
//
// Minimal transactional email via Resend's REST API (no SDK dependency —
// uses fetch, available in the Node runtime on Railway). Reads config from
// the environment and degrades gracefully when unconfigured, mirroring the
// R2 client: if RESEND_API_KEY / MAIL_FROM are absent, isConfigured is false
// and send() throws a clear, catchable error instead of crashing.

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "";

const isConfigured = Boolean(RESEND_API_KEY && MAIL_FROM);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(e) {
  return typeof e === "string" && EMAIL_RE.test(e.trim());
}

/**
 * Send an email through Resend.
 * @param {{ to: string[], subject: string, html: string, replyTo?: string,
 *           attachments?: { filename: string, content: Buffer }[] }} msg
 * @returns {Promise<{id: string}>}
 */
async function send({ to, subject, html, replyTo, attachments }) {
  if (!isConfigured) {
    const err = new Error("Email is not configured on the server.");
    err.code = "MAIL_NOT_CONFIGURED";
    throw err;
  }
  const recipients = (Array.isArray(to) ? to : [to]).map((e) => String(e).trim()).filter(isValidEmail);
  if (recipients.length === 0) {
    const err = new Error("No valid recipient email addresses.");
    err.code = "MAIL_NO_RECIPIENTS";
    throw err;
  }

  const body = {
    from: MAIL_FROM,
    to: recipients,
    subject: subject || "(no subject)",
    html: html || "",
  };
  if (replyTo && isValidEmail(replyTo)) body.reply_to = replyTo;
  if (Array.isArray(attachments) && attachments.length > 0) {
    const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB combined, well under Resend's request limit
    let totalBytes = 0;
    body.attachments = attachments.map((a) => {
      totalBytes += a.content.length;
      return { filename: a.filename, content: a.content.toString("base64") };
    });
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      const err = new Error("Attachment is too large to email. Try exporting a narrower date range.");
      err.code = "MAIL_ATTACHMENT_TOO_LARGE";
      throw err;
    }
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j && (j.message || j.error || JSON.stringify(j));
    } catch {
      detail = await res.text().catch(() => "");
    }
    const err = new Error(`Email send failed (${res.status}). ${detail || ""}`.trim());
    err.code = "MAIL_SEND_FAILED";
    err.status = res.status;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  return { id: data.id || null };
}

// Basic HTML escaping for user-provided text placed into the email body.
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { isConfigured, send, isValidEmail, escapeHtml };
