// backend/routes/rfis.js
//
// Per-project RFIs (Requests For Information). Workflow: open -> answered ->
// closed (reopen allowed). Attachments reuse the R2/Documents pipeline.
//
// Permissions:
//   - raise (create/edit): admin/staff or trade_partner (project members).
//   - answer/close/reopen: admin/staff or client (project members).
//   - view: any project member.  delete: admin/staff.
//   - trade partners can raise but not answer; clients can answer but not raise.

const express = require("express");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject, resourceProjectId } = require("./projects");
const { requireModule } = require("../orgModules");
const r2 = require("../db/r2");

const router = express.Router();

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
  if (!r2.isConfigured) return res.status(503).json({ error: "File storage is not configured yet." });
  next();
}
function buildStorageKey(projectId, fileName) {
  const safe = (fileName || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `projects/${projectId}/${crypto.randomUUID()}-${safe}`;
}

async function isProjectMember(userId, projectId) {
  const r = await pool.query("SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  return r.rows.length > 0;
}
// Who can raise an RFI: internal, or a trade-partner member.
async function canRaise(user, projectId) {
  if (isInternal(user)) return true;
  if (user.role === "trade_partner") return isProjectMember(user.id, projectId);
  return false;
}
// Who can answer/close/reopen: internal, or a client member.
async function canAnswer(user, projectId) {
  if (isInternal(user)) return true;
  if (user.role === "client") return isProjectMember(user.id, projectId);
  return false;
}

function mapRfi(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    rfiNumber: row.rfi_number,
    subject: row.subject,
    question: row.question,
    status: row.status,
    dueDate: row.due_date,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name || null,
    answer: row.answer,
    answeredByName: row.answered_by_name || null,
    answeredAt: row.answered_at,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
  };
}

async function fetchRfi(id, runner = pool) {
  const r = await runner.query(
    `SELECT r.*, au.full_name AS assigned_to_name, anu.full_name AS answered_by_name, cu.full_name AS created_by_name
       FROM rfis r
       LEFT JOIN users au ON au.id = r.assigned_to
       LEFT JOIN users anu ON anu.id = r.answered_by
       LEFT JOIN users cu ON cu.id = r.created_by
      WHERE r.id = $1`,
    [id]
  );
  return r.rows[0] ? mapRfi(r.rows[0]) : null;
}

// ============================================================
// LIST
// ============================================================
router.get("/projects/:projectId/rfis", requireAuth, requireModule("rfis"), guardProject, async (req, res) => {
  try {
    const rfisRes = await pool.query(
      `SELECT r.*, au.full_name AS assigned_to_name, anu.full_name AS answered_by_name, cu.full_name AS created_by_name
         FROM rfis r
         LEFT JOIN users au ON au.id = r.assigned_to
         LEFT JOIN users anu ON anu.id = r.answered_by
         LEFT JOIN users cu ON cu.id = r.created_by
        WHERE r.project_id = $1
        ORDER BY r.rfi_number DESC`,
      [req.params.projectId]
    );
    const rfiIds = rfisRes.rows.map((r) => r.id);
    const attachRes = await pool.query(
      `SELECT rd.id, rd.rfi_id, rd.document_id, d.file_name, d.uploaded_by
         FROM rfi_documents rd JOIN documents d ON d.id = rd.document_id
        WHERE rd.rfi_id = ANY($1::uuid[]) ORDER BY rd.created_at ASC`,
      [rfiIds]
    );
    const byRfi = {};
    for (const a of attachRes.rows) {
      (byRfi[a.rfi_id] = byRfi[a.rfi_id] || []).push({
        id: a.id, documentId: a.document_id, fileName: a.file_name,
        canDelete: isInternal(req.user) || a.uploaded_by === req.user.id,
      });
    }
    // Project members for the assignee dropdown.
    const membersRes = await pool.query(
      `SELECT u.id, u.full_name, u.email FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY u.full_name ASC`,
      [req.params.projectId]
    );

    const rfis = rfisRes.rows.map((row) => {
      const rfi = mapRfi(row);
      rfi.attachments = byRfi[rfi.id] || [];
      return rfi;
    });

    res.json({
      rfis,
      canRaise: await canRaise(req.user, req.params.projectId),
      canAnswer: await canAnswer(req.user, req.params.projectId),
      members: membersRes.rows.map((m) => ({ id: m.id, fullName: m.full_name, email: m.email })),
    });
  } catch (err) {
    console.error("[radah-pm] list rfis error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// CREATE (admin/staff or trade-partner member)
// ============================================================
router.post("/projects/:projectId/rfis", requireAuth, requireModule("rfis"), guardProject, async (req, res) => {
  try {
    if (!(await canRaise(req.user, req.params.projectId))) {
      return res.status(403).json({ error: "You don't have permission to raise RFIs on this project." });
    }
    const { subject, question, dueDate, assignedTo } = req.body || {};
    if (!subject || !subject.trim()) return res.status(400).json({ error: "A subject is required." });

    if (assignedTo) {
      if (!(await isProjectMember(assignedTo, req.params.projectId))) {
        // allow assigning to internal staff too (not necessarily members)
        const internalUser = await pool.query("SELECT 1 FROM users u WHERE u.id = $1 AND u.role IN ('admin','staff') AND u.org_id = (SELECT org_id FROM projects WHERE id = $2)", [assignedTo, req.params.projectId]);
        if (internalUser.rows.length === 0) {
          return res.status(400).json({ error: "Assignee must be a project member or staff in your organization." });
        }
      }
    }

    const numRes = await pool.query("SELECT COALESCE(MAX(rfi_number),0)+1 AS next FROM rfis WHERE project_id = $1", [req.params.projectId]);
    const ins = await pool.query(
      `INSERT INTO rfis (project_id, rfi_number, subject, question, due_date, assigned_to, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'open',$7) RETURNING id`,
      [req.params.projectId, numRes.rows[0].next, subject.trim(), question || null, dueDate || null, assignedTo || null, req.user.id]
    );
    res.status(201).json({ rfi: await fetchRfi(ins.rows[0].id) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "RFI number collision — please retry." });
    console.error("[radah-pm] create rfi error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// EDIT (admin/staff or the raiser) — metadata only, while not closed
// ============================================================
router.patch("/rfis/:id", requireAuth, requireModule("rfis"), guardResource("rfis"), async (req, res) => {
  try {
    const cur = await pool.query("SELECT * FROM rfis WHERE id = $1", [req.params.id]);
    const rfi = cur.rows[0];
    if (!rfi) return res.status(404).json({ error: "RFI not found." });
    const isRaiser = rfi.created_by === req.user.id;
    if (!isInternal(req.user) && !isRaiser) {
      return res.status(403).json({ error: "Only the person who raised the RFI or staff can edit it." });
    }
    if (rfi.status === "closed") return res.status(409).json({ error: "Closed RFIs can't be edited. Reopen it first." });

    const updates = []; const values = []; let i = 1;
    if (req.body.subject !== undefined) {
      if (!String(req.body.subject).trim()) return res.status(400).json({ error: "Subject cannot be empty." });
      updates.push(`subject = $${i}`); values.push(String(req.body.subject).trim()); i++;
    }
    if (req.body.question !== undefined) { updates.push(`question = $${i}`); values.push(req.body.question || null); i++; }
    if (req.body.dueDate !== undefined) { updates.push(`due_date = $${i}`); values.push(req.body.dueDate || null); i++; }
    if (req.body.assignedTo !== undefined) { updates.push(`assigned_to = $${i}`); values.push(req.body.assignedTo || null); i++; }
    if (updates.length === 0) return res.status(400).json({ error: "No valid fields to update." });
    values.push(req.params.id);
    await pool.query(`UPDATE rfis SET ${updates.join(", ")} WHERE id = $${i}`, values);
    res.json({ rfi: await fetchRfi(req.params.id) });
  } catch (err) {
    console.error("[radah-pm] update rfi error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// TRANSITION: answer | close | reopen
// ============================================================
router.post("/rfis/:id/transition", requireAuth, requireModule("rfis"), guardResource("rfis"), async (req, res) => {
  const action = (req.body && req.body.action) || "";
  if (!["answer", "close", "reopen"].includes(action)) return res.status(400).json({ error: "Unknown action." });
  try {
    const cur = await pool.query("SELECT * FROM rfis WHERE id = $1", [req.params.id]);
    const rfi = cur.rows[0];
    if (!rfi) return res.status(404).json({ error: "RFI not found." });
    if (!(await canAnswer(req.user, rfi.project_id))) {
      return res.status(403).json({ error: "You don't have permission to respond to RFIs on this project." });
    }

    if (action === "answer") {
      const answer = (req.body.answer || "").trim();
      if (!answer) return res.status(400).json({ error: "An answer is required." });
      if (rfi.status === "closed") return res.status(409).json({ error: "Reopen the RFI before answering." });
      await pool.query(
        "UPDATE rfis SET status = 'answered', answer = $1, answered_by = $2, answered_at = now() WHERE id = $3",
        [answer, req.user.id, rfi.id]
      );
    } else if (action === "close") {
      if (rfi.status === "closed") return res.status(409).json({ error: "RFI is already closed." });
      await pool.query("UPDATE rfis SET status = 'closed' WHERE id = $1", [rfi.id]);
    } else if (action === "reopen") {
      if (rfi.status === "open") return res.status(409).json({ error: "RFI is already open." });
      await pool.query("UPDATE rfis SET status = 'open' WHERE id = $1", [rfi.id]);
    }
    res.json({ rfi: await fetchRfi(req.params.id) });
  } catch (err) {
    console.error("[radah-pm] rfi transition error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// DELETE (admin/staff)
// ============================================================
router.delete("/rfis/:id", requireAuth, requireModule("rfis"), requireRole("admin", "staff"), guardResource("rfis"), async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM rfis WHERE id = $1 RETURNING id", [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: "RFI not found." });
    res.json({ message: "RFI deleted." });
  } catch (err) {
    console.error("[radah-pm] delete rfi error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// ATTACHMENTS (reuse R2/Documents) — any project member
// ============================================================
router.post("/projects/:projectId/rfis/:rfiId/attachments/upload-url", requireAuth, requireModule("rfis"), requireR2, guardProject, async (req, res) => {
  try {
    const rfi = await pool.query("SELECT id, project_id FROM rfis WHERE id = $1", [req.params.rfiId]);
    if (!rfi.rows[0] || rfi.rows[0].project_id !== req.params.projectId) return res.status(404).json({ error: "RFI not found." });
    const { fileName, contentType } = req.body || {};
    if (!fileName) return res.status(400).json({ error: "fileName is required." });
    const storageKey = buildStorageKey(req.params.projectId, fileName);
    const uploadUrl = await r2.getUploadUrl(storageKey, contentType);
    res.json({ uploadUrl, storageKey });
  } catch (err) {
    console.error("[radah-pm] rfi attachment upload-url error:", err);
    res.status(500).json({ error: "Could not prepare the upload." });
  }
});

router.post("/projects/:projectId/rfis/:rfiId/attachments/confirm", requireAuth, requireModule("rfis"), requireR2, guardProject, async (req, res) => {
  const { storageKey, fileName, contentType, sizeBytes } = req.body || {};
  if (!storageKey || !fileName) return res.status(400).json({ error: "storageKey and fileName are required." });
  if (!storageKey.startsWith(`projects/${req.params.projectId}/`)) return res.status(400).json({ error: "Invalid storage key for this project." });
  const client = await pool.connect();
  try {
    const rfi = await pool.query("SELECT id, project_id FROM rfis WHERE id = $1", [req.params.rfiId]);
    if (!rfi.rows[0] || rfi.rows[0].project_id !== req.params.projectId) { client.release(); return res.status(404).json({ error: "RFI not found." }); }
    await client.query("BEGIN");
    const docRes = await client.query(
      `INSERT INTO documents (project_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.params.projectId, storageKey, fileName, contentType || null, sizeBytes || null, "RFI attachment", req.user.id]
    );
    const documentId = docRes.rows[0].id;
    const linkRes = await client.query("INSERT INTO rfi_documents (rfi_id, document_id) VALUES ($1,$2) RETURNING id", [req.params.rfiId, documentId]);
    await client.query("COMMIT");
    res.status(201).json({ attachment: { id: linkRes.rows[0].id, documentId, fileName, canDelete: true } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] rfi attachment confirm error:", err);
    res.status(500).json({ error: "Could not save the attachment." });
  } finally {
    client.release();
  }
});

router.delete("/rfi-documents/:id", requireAuth, requireModule("rfis"), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rd.id, d.uploaded_by, d.project_id FROM rfi_documents rd JOIN documents d ON d.id = rd.document_id WHERE rd.id = $1`,
      [req.params.id]
    );
    const link = r.rows[0];
    if (!link) return res.status(404).json({ error: "Attachment not found." });
    if (!(await userCanAccessProject(req.user, link.project_id))) return res.status(404).json({ error: "Attachment not found." });
    const canDelete = isInternal(req.user) || link.uploaded_by === req.user.id;
    if (!canDelete) return res.status(403).json({ error: "Only the uploader or staff can remove this attachment." });
    await pool.query("DELETE FROM rfi_documents WHERE id = $1", [req.params.id]);
    res.json({ message: "Attachment removed." });
  } catch (err) {
    console.error("[radah-pm] delete rfi attachment error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
