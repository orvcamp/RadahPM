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
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject, resourceProjectId } = require("./projects");
const r2 = require("../db/r2");
const mail = require("../mail");
const { notifyProject } = require("../notify");
const APP_NAME = process.env.APP_NAME || "MangoDoe";
const { requireModule } = require("../orgModules");

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

function mapLog(row, photos, manpower) {
  return {
    id: row.id,
    projectId: row.project_id,
    logDate: row.log_date,
    // site times
    timeOnSite: row.time_on_site,
    timeOffSite: row.time_off_site,
    // weather
    weather: row.weather,
    temperature: row.temperature,
    tempHigh: row.temp_high,
    tempLow: row.temp_low,
    precipitation: row.precipitation,
    wind: row.wind,
    weatherDelay: row.weather_delay === true,
    // work
    workPerformed: row.work_performed,
    plannedWork: row.planned_work,
    crewCount: row.crew_count,
    equipment: row.equipment,
    // site activity
    deliveries: row.deliveries,
    visitors: row.visitors,
    inspections: row.inspections,
    // safety
    safetyIncidents: row.safety_incidents,
    safetyObservations: row.safety_observations,
    toolboxTalk: row.toolbox_talk,
    // issues
    delays: row.delays,
    notes: row.notes,
    // meta
    createdById: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    manpower: manpower || [],
    // "photos" kept for backwards compatibility; these are attachments of any type
    photos: photos || [],
    attachments: photos || [],
  };
}

// Fields shared by create + update (body key -> column).
const LOG_FIELDS = {
  logDate: "log_date",
  timeOnSite: "time_on_site",
  timeOffSite: "time_off_site",
  weather: "weather",
  temperature: "temperature",
  tempHigh: "temp_high",
  tempLow: "temp_low",
  precipitation: "precipitation",
  wind: "wind",
  weatherDelay: "weather_delay",
  workPerformed: "work_performed",
  plannedWork: "planned_work",
  crewCount: "crew_count",
  equipment: "equipment",
  deliveries: "deliveries",
  visitors: "visitors",
  inspections: "inspections",
  safetyIncidents: "safety_incidents",
  safetyObservations: "safety_observations",
  toolboxTalk: "toolbox_talk",
  delays: "delays",
  notes: "notes",
};

const INT_FIELDS = new Set(["crewCount", "tempHigh", "tempLow"]);

function coerce(bodyKey, value) {
  if (value === "" || value === undefined) return null;
  if (bodyKey === "weatherDelay") return value === true || value === "true";
  if (INT_FIELDS.has(bodyKey)) {
    if (value === null) return null;
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error(`${bodyKey} must be a whole number.`);
    if (bodyKey === "crewCount" && n < 0) throw new Error("Crew count must be 0 or more.");
    return n;
  }
  return value === null ? null : value;
}

// Replace a log's manpower rows (simple + predictable).
async function replaceManpower(client, logId, rows) {
  await client.query("DELETE FROM daily_log_manpower WHERE daily_log_id = $1", [logId]);
  if (!Array.isArray(rows) || rows.length === 0) return;
  let order = 0;
  for (const r of rows) {
    const workers = Number(r.workers || 0);
    if (!Number.isInteger(workers) || workers < 0) throw new Error("Manpower workers must be a whole number (>= 0).");
    const hours = r.hours === "" || r.hours === undefined || r.hours === null ? null : Number(r.hours);
    if (hours !== null && (Number.isNaN(hours) || hours < 0)) throw new Error("Manpower hours must be a positive number.");
    await client.query(
      `INSERT INTO daily_log_manpower (daily_log_id, company, trade, workers, hours, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [logId, r.company || null, r.trade || null, workers, hours, r.notes || null, order++]
    );
  }
}

async function manpowerFor(logIds) {
  if (!logIds.length) return {};
  const r = await pool.query(
    "SELECT * FROM daily_log_manpower WHERE daily_log_id = ANY($1::uuid[]) ORDER BY sort_order ASC",
    [logIds]
  );
  const byLog = {};
  for (const row of r.rows) {
    (byLog[row.daily_log_id] = byLog[row.daily_log_id] || []).push({
      id: row.id,
      company: row.company,
      trade: row.trade,
      workers: row.workers,
      hours: row.hours === null ? null : Number(row.hours),
      notes: row.notes,
    });
  }
  return byLog;
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
router.get("/projects/:projectId/daily-logs", requireAuth, requireModule("dailylogs"), async (req, res) => {
  try {
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }

    const logsRes = await pool.query(
      `SELECT dl.*, u.full_name AS created_by_name
         FROM daily_logs dl
         LEFT JOIN users u ON u.id = dl.created_by
        WHERE dl.project_id = $1 AND dl.deleted_at IS NULL
        ORDER BY dl.log_date DESC, dl.created_at DESC`,
      [req.params.projectId]
    );

    const logIds = logsRes.rows.map((r) => r.id);

    // Attachments (any file type) for all logs in one query, then group.
    const photosRes = await pool.query(
      `SELECT p.id, p.daily_log_id, p.document_id, d.file_name, d.storage_key, d.content_type
         FROM daily_log_photos p
         JOIN documents d ON d.id = p.document_id
        WHERE p.daily_log_id = ANY($1::uuid[])`,
      [logIds]
    );

    const photosByLog = {};
    for (const p of photosRes.rows) {
      const isImage = (p.content_type || "").startsWith("image/");
      let viewUrl = null;
      if (r2.isConfigured) {
        try {
          // Images render inline as thumbnails; other files get a download link.
          viewUrl = isImage
            ? await r2.getViewUrl(p.storage_key, p.content_type)
            : await r2.getDownloadUrl(p.storage_key, p.file_name);
        } catch { viewUrl = null; }
      }
      (photosByLog[p.daily_log_id] = photosByLog[p.daily_log_id] || []).push({
        id: p.id,
        documentId: p.document_id,
        fileName: p.file_name,
        contentType: p.content_type || null,
        isImage,
        viewUrl,
      });
    }

    const manpowerByLog = await manpowerFor(logIds);

    const logs = logsRes.rows.map((row) => {
      const log = mapLog(row, photosByLog[row.id] || [], manpowerByLog[row.id] || []);
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
  const client = await pool.connect();
  try {
    if (req.user.role === "client") {
      client.release();
      return res.status(403).json({ error: "Clients can view daily logs but not create them." });
    }
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      client.release();
      return res.status(403).json({ error: "You do not have access to this project." });
    }
    if (!req.body || !req.body.logDate) {
      client.release();
      return res.status(400).json({ error: "A log date is required." });
    }

    const cols = ["project_id"], vals = [req.params.projectId], ph = ["$1"];
    let i = 2;
    for (const [bodyKey, col] of Object.entries(LOG_FIELDS)) {
      if (req.body[bodyKey] !== undefined) {
        cols.push(col); vals.push(coerce(bodyKey, req.body[bodyKey])); ph.push(`$${i++}`);
      }
    }
    cols.push("created_by"); vals.push(req.user.id); ph.push(`$${i++}`);

    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO daily_logs (${cols.join(", ")}) VALUES (${ph.join(", ")}) RETURNING id`,
      vals
    );
    const logId = ins.rows[0].id;
    if (req.body.manpower !== undefined) await replaceManpower(client, logId, req.body.manpower);
    await client.query("COMMIT");

    const withName = await pool.query(
      `SELECT dl.*, u.full_name AS created_by_name FROM daily_logs dl
       LEFT JOIN users u ON u.id = dl.created_by WHERE dl.id = $1`,
      [logId]
    );
    const mp = await manpowerFor([logId]);
    const created = mapLog(withName.rows[0], [], mp[logId] || []);
    await notifyProject({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
      actorId: req.user.id,
      actorName: req.user.fullName,
      type: "dailylog.filed",
      title: `Daily log filed for ${new Date(created.logDate).toLocaleDateString()}`,
      body: `${req.user.fullName || "Someone"} filed a daily log.`,
      tab: "dailylogs",
    });
    res.status(201).json({ log: created });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err && /must be/.test(err.message)) return res.status(400).json({ error: err.message });
    console.error("[radah-pm] create daily log error:", err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    client.release();
  }
});

// ============================================================
// EDIT — PATCH /api/daily-logs/:id
// Internal, or the trade partner who authored it.
// ============================================================
router.patch("/daily-logs/:id", requireAuth, guardResource("daily_logs"), async (req, res) => {
  const client = await pool.connect();
  try {
    const logRow = await getLogRow(req.params.id);
    if (!logRow) { client.release(); return res.status(404).json({ error: "Daily log not found." }); }
    if (!canEditLog(req.user, logRow)) {
      client.release();
      return res.status(403).json({ error: "You can only edit your own daily logs." });
    }

    const updates = [], values = [];
    let i = 1;
    for (const [bodyKey, col] of Object.entries(LOG_FIELDS)) {
      if (req.body[bodyKey] !== undefined) {
        if (bodyKey === "logDate" && !req.body.logDate) {
          client.release();
          return res.status(400).json({ error: "Log date cannot be empty." });
        }
        updates.push(`${col} = $${i}`); values.push(coerce(bodyKey, req.body[bodyKey])); i++;
      }
    }

    await client.query("BEGIN");
    if (updates.length > 0) {
      values.push(req.params.id);
      await client.query(`UPDATE daily_logs SET ${updates.join(", ")} WHERE id = $${i}`, values);
    }
    if (req.body.manpower !== undefined) await replaceManpower(client, req.params.id, req.body.manpower);
    await client.query("COMMIT");

    const withName = await pool.query(
      `SELECT dl.*, u.full_name AS created_by_name FROM daily_logs dl
       LEFT JOIN users u ON u.id = dl.created_by WHERE dl.id = $1`,
      [req.params.id]
    );
    const mp = await manpowerFor([req.params.id]);
    res.json({ log: mapLog(withName.rows[0], [], mp[req.params.id] || []) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err && /must be/.test(err.message)) return res.status(400).json({ error: err.message });
    console.error("[radah-pm] update daily log error:", err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    client.release();
  }
});

// ============================================================
// DELETE — DELETE /api/daily-logs/:id
// Internal, or the trade partner who authored it. Linked photos'
// document rows remain in the project library (only the link is removed
// by the cascade on daily_log_photos).
// ============================================================
router.delete("/daily-logs/:id", requireAuth, requireRole("admin"), guardResource("daily_logs"), async (req, res) => {
  try {
    const logRow = await getLogRow(req.params.id);
    if (!logRow) return res.status(404).json({ error: "Daily log not found." });
    await pool.query(
      "UPDATE daily_logs SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL",
      [req.user.id, req.params.id]
    );
    res.json({ message: "Daily log moved to Deleted Items. An admin can restore it." });
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
      const isImage = (contentType || "").startsWith("image/");
      try {
        viewUrl = isImage ? await r2.getViewUrl(storageKey, contentType) : await r2.getDownloadUrl(storageKey, fileName);
      } catch { viewUrl = null; }
      res.status(201).json({
        photo: { id: linkRes.rows[0].id, documentId, fileName, contentType: contentType || null, isImage, viewUrl },
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

      // Manpower summary line for the email.
      const mpRes = await pool.query(
        "SELECT company, trade, workers, hours FROM daily_log_manpower WHERE daily_log_id = $1 ORDER BY sort_order ASC",
        [req.params.logId]
      );
      const manpowerSummary = mpRes.rows
        .map((m) => `${[m.company, m.trade].filter(Boolean).join(" / ")}: ${m.workers} worker(s)${m.hours != null ? `, ${Number(m.hours)} hrs` : ""}`)
        .join("\n");

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
            ${row("Time On / Off Site", [log.time_on_site, log.time_off_site].filter(Boolean).join(" – "))}
            ${row("Weather", [log.weather, log.temperature, [log.temp_high, log.temp_low].filter((x) => x != null).join("/"), log.precipitation, log.wind].filter(Boolean).join(", "))}
            ${log.weather_delay ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Weather Delay</td><td style="padding:6px 0;color:#B23B3B;"><strong>Yes</strong></td></tr>` : ""}
            ${row("Manpower", manpowerSummary)}
            ${row("Crew Count", log.crew_count != null ? String(log.crew_count) : "")}
            ${row("Work Performed", log.work_performed)}
            ${row("Planned Work (Look-Ahead)", log.planned_work)}
            ${row("Equipment On Site", log.equipment)}
            ${row("Deliveries Received", log.deliveries)}
            ${row("Visitors On Site", log.visitors)}
            ${row("Inspections", log.inspections)}
            ${row("Safety Incidents", log.safety_incidents)}
            ${row("Safety Observations", log.safety_observations)}
            ${row("Toolbox Talk / JHA", log.toolbox_talk)}
            ${row("Delays / Issues", log.delays)}
            ${row("Notes", log.notes)}
          </table>
          ${photosHtml}
          <hr style="border:none;border-top:1px solid #E2E1DA;margin:20px 0;">
          <p style="font-size:12px;color:#9ca3af;">Sent by ${esc(senderName)} via ${APP_NAME}.</p>
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
