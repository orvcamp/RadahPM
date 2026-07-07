// backend/routes/dailylogs.js
//
// Per-project daily field reports. Multiple entries per day allowed.
//
// Permissions:
//   - admin/staff : create, edit, delete any log; view all.
//   - trade_partner: create logs; edit/delete ONLY their own; view all on
//                    projects they belong to. (First trade-partner-writable module.)
//   - client      : view only.
//
// Photos reuse the Documents R2 pipeline: uploading a log photo creates a
// normal project document (in the documents table / R2 bucket) and links it
// to the log via daily_log_photos. So a log photo also appears in Documents.

const express = require("express");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, isInternal } = require("../middleware/auth");
const { userCanAccessProject, resourceProjectId } = require("./projects");
const r2 = require("../db/r2");
const mail = require("../mail");

const router = express.Router();

// --- org-isolation guards (Phase 3 A2) ---
function guardProject(req, res, next) {
  userCanAccessProject(req.user, req.params.projectId)
    .then((ok) => (ok ? next() : res.status(403).json({ error: "You do not have access to this project." })))
    .catch(next);
}
function guardResource(table) {
  return async (req, res, next) => {
    try {
      const pid = await resourceProjectId(table, req.params.id);
      if (!pid || !(await userCanAccessProject(req.user, pid))) {
        return res.status(404).json({ error: "Not found." });
      }
      next();
    } catch (e) { next(e); }
  };
}

function requireR2(req, res, next) {
  if (!r2.isConfigured) {
    return res.status(503).json({ error: "Photo storage is not configured yet. Please contact your administrator." });
  }
  next();
}

function buildStorageKey(projectId, fileName) {
  const safeName = (fileName || "photo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `projects/${projectId}/${crypto.randomUUID()}-${safeName}`;
}

function mapLog(row, photos) {
  return {
    id: row.id,
    projectId: row.project_id,
    logDate: row.log_date,
    weather: row.weather,
    temperature: row.temperature,
    workPerformed: row.work_performed,
    crewCount: row.crew_count,
    equipment: row.equipment,
    delays: row.delays,
    notes: row.notes,
    createdById: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    photos: photos || [],
  };
}

// Load a log row (raw) by id.
async function getLogRow(id) {
  const r = await pool.query("SELECT * FROM daily_logs WHERE id = $1", [id]);
  return r.rows[0] || null;
}

// Can this user edit/delete the given log row?
function canEditLog(user, logRow) {
  if (isInternal(user)) return true;
  if (user.role === "trade_partner" && logRow.created_by === user.id) return true;
  return false;
}

// ============================================================
// LIST — GET /api/projects/:projectId/daily-logs
// Any project member (admin/staff/client/trade_partner).
// Each log includes its photos with short-lived view URLs.
// ============================================================
router.get("/projects/:projectId/daily-logs", requireAuth, async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }

    const logsRes = await pool.query(
      `SELECT dl.*, u.full_name AS created_by_name
         FROM daily_logs dl
         LEFT JOIN users u ON u.id = dl.created_by
        WHERE dl.project_id = $1
        ORDER BY dl.log_date DESC, dl.created_at DESC`,
      [req.params.projectId]
    );

    // Fetch photos for all logs in one query, then group.
    const photosRes = await pool.query(
      `SELECT p.id, p.daily_log_id, p.document_id, d.file_name, d.storage_key
         FROM daily_log_photos p
         JOIN documents d ON d.id = p.document_id
        WHERE p.daily_log_id = ANY($1::uuid[])`,
      [logsRes.rows.map((r) => r.id)]
    );

    const photosByLog = {};
    for (const p of photosRes.rows) {
      let viewUrl = null;
      if (r2.isConfigured) {
        try { viewUrl = await r2.getDownloadUrl(p.storage_key, p.file_name); } catch { viewUrl = null; }
      }
      (photosByLog[p.daily_log_id] = photosByLog[p.daily_log_id] || []).push({
        id: p.id,
        documentId: p.document_id,
        fileName: p.file_name,
        viewUrl,
      });
    }

    const logs = logsRes.rows.map((row) => {
      const log = mapLog(row, photosByLog[row.id] || []);
      log.canEdit = canEditLog(req.user, row);
      return log;
    });

    res.json({
      canCreate: isInternal(req.user) || req.user.role === "trade_partner",
      currentUserId: req.user.id,
      logs,
    });
  } catch (err) {
    console.error("[radah-pm] list daily logs error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// CREATE — POST /api/projects/:projectId/daily-logs
// admin/staff or trade_partner (project member). Not clients.
// ============================================================
router.post("/projects/:projectId/daily-logs", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "client") {
      return res.status(403).json({ error: "Clients can view daily logs but not create them." });
    }
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }

    const { logDate, weather, temperature, workPerformed, crewCount, equipment, delays, notes } =
      req.body || {};
    if (!logDate) {
      return res.status(400).json({ error: "A log date is required." });
    }
    let crew = null;
    if (crewCount !== undefined && crewCount !== null && crewCount !== "") {
      const n = Number(crewCount);
      if (!Number.isInteger(n) || n < 0) {
        return res.status(400).json({ error: "Crew count must be a whole number (>= 0)." });
      }
      crew = n;
    }

    const ins = await pool.query(
      `INSERT INTO daily_logs
         (project_id, log_date, weather, temperature, work_performed, crew_count, equipment, delays, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.params.projectId,
        logDate,
        weather || null,
        temperature || null,
        workPerformed || null,
        crew,
        equipment || null,
        delays || null,
        notes || null,
        req.user.id,
      ]
    );
    const withName = await pool.query(
      `SELECT dl.*, u.full_name AS created_by_name FROM daily_logs dl
       LEFT JOIN users u ON u.id = dl.created_by WHERE dl.id = $1`,
      [ins.rows[0].id]
    );
    const log = mapLog(withName.rows[0], []);
    log.canEdit = true;
    res.status(201).json({ log });
  } catch (err) {
    console.error("[radah-pm] create daily log error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// EDIT — PATCH /api/daily-logs/:id
// Internal, or the trade partner who authored it.
// ============================================================
router.patch("/daily-logs/:id", requireAuth, guardResource("daily_logs"), async (req, res) => {
  try {
    const logRow = await getLogRow(req.params.id);
    if (!logRow) return res.status(404).json({ error: "Daily log not found." });
    if (!canEditLog(req.user, logRow)) {
      return res.status(403).json({ error: "You can only edit your own daily logs." });
    }

    const bodyKeyMap = {
      logDate: "log_date",
      weather: "weather",
      temperature: "temperature",
      workPerformed: "work_performed",
      crewCount: "crew_count",
      equipment: "equipment",
      delays: "delays",
      notes: "notes",
    };
    const updates = [];
    const values = [];
    let i = 1;
    for (const [bodyKey, col] of Object.entries(bodyKeyMap)) {
      if (req.body[bodyKey] !== undefined) {
        if (bodyKey === "crewCount") {
          let crew = null;
          if (req.body.crewCount !== null && req.body.crewCount !== "") {
            const n = Number(req.body.crewCount);
            if (!Number.isInteger(n) || n < 0) {
              return res.status(400).json({ error: "Crew count must be a whole number (>= 0)." });
            }
            crew = n;
          }
          updates.push(`${col} = $${i}`); values.push(crew); i++;
        } else if (bodyKey === "logDate") {
          if (!req.body.logDate) return res.status(400).json({ error: "Log date cannot be empty." });
          updates.push(`${col} = $${i}`); values.push(req.body.logDate); i++;
        } else {
          updates.push(`${col} = $${i}`); values.push(req.body[bodyKey] || null); i++;
        }
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields provided to update." });
    }
    values.push(req.params.id);
    await pool.query(`UPDATE daily_logs SET ${updates.join(", ")} WHERE id = $${i}`, values);

    const withName = await pool.query(
      `SELECT dl.*, u.full_name AS created_by_name FROM daily_logs dl
       LEFT JOIN users u ON u.id = dl.created_by WHERE dl.id = $1`,
      [req.params.id]
    );
    const log = mapLog(withName.rows[0], []);
    log.canEdit = true;
    res.json({ log });
  } catch (err) {
    console.error("[radah-pm] update daily log error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// DELETE — DELETE /api/daily-logs/:id
// Internal, or the trade partner who authored it. Linked photos'
// document rows remain in the project library (only the link is removed
// by the cascade on daily_log_photos).
// ============================================================
router.delete("/daily-logs/:id", requireAuth, guardResource("daily_logs"), async (req, res) => {
  try {
    const logRow = await getLogRow(req.params.id);
    if (!logRow) return res.status(404).json({ error: "Daily log not found." });
    if (!canEditLog(req.user, logRow)) {
      return res.status(403).json({ error: "You can only delete your own daily logs." });
    }
    await pool.query("DELETE FROM daily_logs WHERE id = $1", [req.params.id]);
    res.json({ message: "Daily log deleted." });
  } catch (err) {
    console.error("[radah-pm] delete daily log error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// PHOTOS — reuse the Documents R2 flow
// ============================================================

// Step 1: presigned upload URL.
// POST /api/projects/:projectId/daily-logs/:logId/photos/upload-url
// Body: { fileName, contentType }
router.post(
  "/projects/:projectId/daily-logs/:logId/photos/upload-url",
  requireAuth,
  requireR2,
  guardProject,
  async (req, res) => {
    try {
      const logRow = await getLogRow(req.params.logId);
      if (!logRow || logRow.project_id !== req.params.projectId) {
        return res.status(404).json({ error: "Daily log not found." });
      }
      if (!canEditLog(req.user, logRow)) {
        return res.status(403).json({ error: "You can only add photos to your own daily logs." });
      }
      const { fileName, contentType } = req.body || {};
      if (!fileName) return res.status(400).json({ error: "fileName is required." });
      const storageKey = buildStorageKey(req.params.projectId, fileName);
      const uploadUrl = await r2.getUploadUrl(storageKey, contentType);
      res.json({ uploadUrl, storageKey });
    } catch (err) {
      console.error("[radah-pm] daily log photo upload-url error:", err);
      res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
  }
);

// Step 2: confirm — create the document row and link it to the log.
// POST /api/projects/:projectId/daily-logs/:logId/photos/confirm
// Body: { storageKey, fileName, contentType, sizeBytes }
router.post(
  "/projects/:projectId/daily-logs/:logId/photos/confirm",
  requireAuth,
  requireR2,
  guardProject,
  async (req, res) => {
    const { storageKey, fileName, contentType, sizeBytes } = req.body || {};
    if (!storageKey || !fileName) {
      return res.status(400).json({ error: "storageKey and fileName are required." });
    }
    if (!storageKey.startsWith(`projects/${req.params.projectId}/`)) {
      return res.status(400).json({ error: "Invalid storage key for this project." });
    }
    const client = await pool.connect();
    try {
      const logRow = await getLogRow(req.params.logId);
      if (!logRow || logRow.project_id !== req.params.projectId) {
        return res.status(404).json({ error: "Daily log not found." });
      }
      if (!canEditLog(req.user, logRow)) {
        return res.status(403).json({ error: "You can only add photos to your own daily logs." });
      }

      await client.query("BEGIN");
      const docRes = await client.query(
        `INSERT INTO documents (project_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, file_name`,
        [
          req.params.projectId,
          storageKey,
          fileName,
          contentType || null,
          sizeBytes || null,
          `Daily log photo (${logRow.log_date})`,
          req.user.id,
        ]
      );
      const documentId = docRes.rows[0].id;
      const linkRes = await client.query(
        `INSERT INTO daily_log_photos (daily_log_id, document_id) VALUES ($1, $2) RETURNING id`,
        [req.params.logId, documentId]
      );
      await client.query("COMMIT");

      let viewUrl = null;
      try { viewUrl = await r2.getDownloadUrl(storageKey, fileName); } catch { viewUrl = null; }
      res.status(201).json({
        photo: { id: linkRes.rows[0].id, documentId, fileName, viewUrl },
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[radah-pm] daily log photo confirm error:", err);
      res.status(500).json({ error: "Could not save the photo." });
    } finally {
      client.release();
    }
  }
);

// Detach a photo from a log (keeps the document in the project library).
// DELETE /api/daily-log-photos/:id
router.delete("/daily-log-photos/:id", requireAuth, async (req, res) => {
  try {
    const linkRes = await pool.query(
      `SELECT p.id, p.daily_log_id, dl.created_by, dl.project_id
         FROM daily_log_photos p JOIN daily_logs dl ON dl.id = p.daily_log_id
        WHERE p.id = $1`,
      [req.params.id]
    );
    const link = linkRes.rows[0];
    if (!link) return res.status(404).json({ error: "Photo not found." });
    if (!(await userCanAccessProject(req.user, link.project_id))) {
      return res.status(404).json({ error: "Photo not found." });
    }
    if (!canEditLog(req.user, { created_by: link.created_by })) {
      return res.status(403).json({ error: "You can only edit your own daily logs." });
    }
    await pool.query("DELETE FROM daily_log_photos WHERE id = $1", [req.params.id]);
    res.json({ message: "Photo removed from log." });
  } catch (err) {
    console.error("[radah-pm] delete daily log photo error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// EMAIL A DAILY LOG TO RECIPIENTS
// POST /api/projects/:projectId/daily-logs/:logId/email
// Any project member (guardProject enforces org + project access).
// Body: { recipients: string[], note?: string }
// ============================================================
router.post(
  "/projects/:projectId/daily-logs/:logId/email",
  requireAuth,
  guardProject,
  async (req, res) => {
    if (!mail.isConfigured) {
      return res.status(503).json({ error: "Email is not set up on the server yet. Please contact your administrator." });
    }
    const { recipients, note } = req.body || {};
    const list = Array.isArray(recipients)
      ? recipients.map((e) => String(e).trim()).filter((e) => e)
      : [];
    const valid = list.filter((e) => mail.isValidEmail(e));
    if (valid.length === 0) {
      return res.status(400).json({ error: "Please provide at least one valid recipient email." });
    }
    if (valid.length > 25) {
      return res.status(400).json({ error: "Too many recipients (max 25)." });
    }

    try {
      // Load the log (must belong to this project) with author + project name.
      const logRes = await pool.query(
        `SELECT dl.*, u.full_name AS created_by_name, p.name AS project_name
           FROM daily_logs dl
           LEFT JOIN users u ON u.id = dl.created_by
           JOIN projects p ON p.id = dl.project_id
          WHERE dl.id = $1 AND dl.project_id = $2`,
        [req.params.logId, req.params.projectId]
      );
      const log = logRes.rows[0];
      if (!log) return res.status(404).json({ error: "Daily log not found." });

      // Photos → short-lived view links.
      const photoRes = await pool.query(
        `SELECT d.storage_key, d.file_name
           FROM daily_log_photos p JOIN documents d ON d.id = p.document_id
          WHERE p.daily_log_id = $1`,
        [req.params.logId]
      );
      const photoLinks = [];
      for (const ph of photoRes.rows) {
        if (r2.isConfigured) {
          try { photoLinks.push({ name: ph.file_name, url: await r2.getDownloadUrl(ph.storage_key, ph.file_name) }); }
          catch { /* skip a broken link */ }
        }
      }

      const esc = mail.escapeHtml;
      const dateStr = new Date(log.log_date).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const row = (label, val) =>
        val ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap;">${esc(label)}</td><td style="padding:6px 0;">${esc(val).replace(/\n/g, "<br>")}</td></tr>` : "";

      const senderName = req.user.fullName || req.user.email;
      const noteHtml = note && String(note).trim()
        ? `<p style="margin:0 0 16px;padding:12px;background:#f7f6f2;border-left:3px solid #C9A227;">${esc(note).replace(/\n/g, "<br>")}</p>`
        : "";
      const photosHtml = photoLinks.length
        ? `<p style="margin:16px 0 6px;color:#6b7280;">Photos:</p><ul style="margin:0 0 16px;padding-left:18px;">${photoLinks.map((p) => `<li><a href="${p.url}">${esc(p.name)}</a></li>`).join("")}</ul><p style="font-size:12px;color:#9ca3af;">Photo links expire after a short time.</p>`
        : "";

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#0B1F3A;max-width:640px;margin:0 auto;">
          <h2 style="margin:0 0 4px;">Daily Log — ${esc(log.project_name)}</h2>
          <p style="margin:0 0 16px;color:#6b7280;">${esc(dateStr)}${log.created_by_name ? " · logged by " + esc(log.created_by_name) : ""}</p>
          ${noteHtml}
          <table style="border-collapse:collapse;font-size:14px;">
            ${row("Weather", [log.weather, log.temperature].filter(Boolean).join(", "))}
            ${row("Crew / Manpower", log.crew_count != null ? String(log.crew_count) : "")}
            ${row("Work Performed", log.work_performed)}
            ${row("Equipment On Site", log.equipment)}
            ${row("Delays / Issues", log.delays)}
            ${row("Notes", log.notes)}
          </table>
          ${photosHtml}
          <hr style="border:none;border-top:1px solid #E2E1DA;margin:20px 0;">
          <p style="font-size:12px;color:#9ca3af;">Sent by ${esc(senderName)} via the RADAH PM platform.</p>
        </div>`;

      await mail.send({
        to: valid,
        subject: `Daily Log — ${log.project_name} — ${dateStr}`,
        html,
        replyTo: req.user.email,
      });

      res.json({ message: `Daily log emailed to ${valid.length} recipient${valid.length === 1 ? "" : "s"}.` });
    } catch (err) {
      if (err.code && err.code.startsWith("MAIL_")) {
        return res.status(502).json({ error: err.message });
      }
      console.error("[radah-pm] email daily log error:", err);
      res.status(500).json({ error: "Something went wrong sending the email." });
    }
  }
);

module.exports = router;
