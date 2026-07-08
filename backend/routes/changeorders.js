// backend/routes/changeorders.js
//
// Per-project change orders with a draft -> submitted -> approved/rejected
// workflow and budget integration.
//
// Budget integration:
//   - Approving a CO creates a budget line in its target category, with the
//     CO's cost impact as the budgeted amount (may be negative = credit). The
//     CO stores that line's id. This runs in a DB transaction so the status
//     change and the budget write are atomic. Re-approving a previously
//     reverted CO restores its existing line (idempotent — never double-adds).
//   - Reverting (approved -> submitted) does NOT delete the line. It flags it
//     ("[REVERTED] ...") and zeroes its budgeted amount so it stops affecting
//     the rollup, preserving history.
//
// Permissions:
//   - admin/staff : create, edit, submit, delete; approve/reject; revert.
//   - client      : on their projects, view all + approve/reject SUBMITTED ones.
//   - trade_partner: no access (403), tab hidden in UI.

const express = require("express");
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject, resourceProjectId } = require("./projects");
const { requireModule } = require("../orgModules");
const r2 = require("../db/r2");
const { notifyProject } = require("../notify");

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
    return res.status(503).json({ error: "File storage is not configured yet. Please contact your administrator." });
  }
  next();
}

function buildStorageKey(projectId, fileName) {
  const safeName = (fileName || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `projects/${projectId}/${crypto.randomUUID()}-${safeName}`;
}

// Can this user attach files to change orders on this project?
// Internal always; a client who is a project member; never trade partners.
async function canAttachCO(user, projectId) {
  if (user.role === "trade_partner") return false;
  if (isInternal(user)) return true;
  if (user.role === "client") {
    const r = await pool.query(
      "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, user.id]
    );
    return r.rows.length > 0;
  }
  return false;
}

// Signed cents (allows negative for credits). Returns null if invalid.
function normalizeSignedCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) ||
      Math.abs(n) > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return n;
}

function mapChangeOrder(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    coNumber: row.co_number,
    title: row.title,
    description: row.description,
    costImpactCents: row.cost_impact_cents === null ? 0 : Number(row.cost_impact_cents),
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    status: row.status,
    budgetLineId: row.budget_line_id,
    submittedByName: row.submitted_by_name || null,
    submittedAt: row.submitted_at,
    decidedByName: row.decided_by_name || null,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

// Fetch a single CO joined with names/category, mapped.
async function fetchChangeOrder(id, runner = pool) {
  const r = await runner.query(
    `SELECT co.*, c.name AS category_name,
            su.full_name AS submitted_by_name,
            du.full_name AS decided_by_name
       FROM change_orders co
       LEFT JOIN budget_categories c ON c.id = co.category_id
       LEFT JOIN users su ON su.id = co.submitted_by
       LEFT JOIN users du ON du.id = co.decided_by
      WHERE co.id = $1`,
    [id]
  );
  return r.rows[0] ? mapChangeOrder(r.rows[0]) : null;
}

// ============================================================
// LIST
// GET /api/projects/:projectId/change-orders
// admin/staff + client (project member). trade_partner: 403.
// Also returns the project's budget categories (for the create form).
// ============================================================
router.get("/projects/:projectId/change-orders", requireAuth, requireModule("changeorders"), async (req, res) => {
  try {
    if (req.user.role === "trade_partner") {
      return res.status(403).json({ error: "You do not have access to change orders." });
    }
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }
    const [cosRes, catsRes] = await Promise.all([
      pool.query(
        `SELECT co.*, c.name AS category_name,
                su.full_name AS submitted_by_name,
                du.full_name AS decided_by_name
           FROM change_orders co
           LEFT JOIN budget_categories c ON c.id = co.category_id
           LEFT JOIN users su ON su.id = co.submitted_by
           LEFT JOIN users du ON du.id = co.decided_by
          WHERE co.project_id = $1 AND co.deleted_at IS NULL
          ORDER BY co.co_number DESC`,
        [req.params.projectId]
      ),
      pool.query(
        "SELECT id, name FROM budget_categories WHERE project_id = $1 ORDER BY sort_order ASC, name ASC",
        [req.params.projectId]
      ),
    ]);

    // Attachments for all these COs, grouped by change_order_id.
    const coIds = cosRes.rows.map((r) => r.id);
    const attachRes = await pool.query(
      `SELECT cod.id, cod.change_order_id, cod.document_id, d.file_name, d.uploaded_by
         FROM change_order_documents cod
         JOIN documents d ON d.id = cod.document_id
        WHERE cod.change_order_id = ANY($1::uuid[])
        ORDER BY cod.created_at ASC`,
      [coIds]
    );
    const attachmentsByCO = {};
    for (const a of attachRes.rows) {
      (attachmentsByCO[a.change_order_id] = attachmentsByCO[a.change_order_id] || []).push({
        id: a.id,
        documentId: a.document_id,
        fileName: a.file_name,
        canDelete: isInternal(req.user) || a.uploaded_by === req.user.id,
      });
    }

    const changeOrders = cosRes.rows.map((row) => {
      const co = mapChangeOrder(row);
      co.attachments = attachmentsByCO[co.id] || [];
      return co;
    });

    res.json({
      canManage: isInternal(req.user),
      canDecide: true, // both internal users and project-member clients may decide submitted COs
      canAttach: await canAttachCO(req.user, req.params.projectId),
      categories: catsRes.rows.map((r) => ({ id: r.id, name: r.name })),
      changeOrders,
    });
  } catch (err) {
    console.error("[radah-pm] list change orders error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// CREATE (admin/staff only)
// POST /api/projects/:projectId/change-orders
// Body: { title, description, costImpactCents, categoryId }
// ============================================================
router.post(
  "/projects/:projectId/change-orders",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { title, description, costImpactCents, categoryId } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "A title is required." });
    }
    if (!categoryId) {
      return res.status(400).json({ error: "A target budget category is required." });
    }
    const cents = normalizeSignedCents(costImpactCents);
    if (cents === null) {
      return res.status(400).json({ error: "Cost impact must be a whole number of cents." });
    }
    try {
      // Category must belong to this project.
      const cat = await pool.query(
        "SELECT 1 FROM budget_categories WHERE id = $1 AND project_id = $2",
        [categoryId, req.params.projectId]
      );
      if (cat.rows.length === 0) {
        return res.status(400).json({ error: "That category doesn't belong to this project." });
      }
      // Next CO number for this project.
      const numRes = await pool.query(
        "SELECT COALESCE(MAX(co_number), 0) + 1 AS next FROM change_orders WHERE project_id = $1",
        [req.params.projectId]
      );
      const coNumber = numRes.rows[0].next;

      const ins = await pool.query(
        `INSERT INTO change_orders
           (project_id, co_number, title, description, cost_impact_cents, category_id, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
         RETURNING id`,
        [
          req.params.projectId,
          coNumber,
          title.trim(),
          description || null,
          cents,
          categoryId,
          req.user.id,
        ]
      );
      const co = await fetchChangeOrder(ins.rows[0].id);
      res.status(201).json({ changeOrder: co });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "Change order number collision — please retry." });
      }
      console.error("[radah-pm] create change order error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// EDIT (admin/staff only)
// PATCH /api/change-orders/:id
// Cost impact and category can't change once approved (revert first).
// ============================================================
router.patch(
  "/change-orders/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("change_orders"),
  async (req, res) => {
    try {
      const current = await pool.query("SELECT * FROM change_orders WHERE id = $1", [req.params.id]);
      const co = current.rows[0];
      if (!co) return res.status(404).json({ error: "Change order not found." });

      const changingMoneyOrCat =
        req.body.costImpactCents !== undefined || req.body.categoryId !== undefined;
      if (co.status === "approved" && changingMoneyOrCat) {
        return res.status(409).json({
          error: "This change order is approved. Revert it to Submitted before changing its amount or category.",
        });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (req.body.title !== undefined) {
        if (!String(req.body.title).trim()) return res.status(400).json({ error: "Title cannot be empty." });
        updates.push(`title = $${i}`); values.push(String(req.body.title).trim()); i++;
      }
      if (req.body.description !== undefined) {
        updates.push(`description = $${i}`); values.push(req.body.description || null); i++;
      }
      if (req.body.costImpactCents !== undefined) {
        const cents = normalizeSignedCents(req.body.costImpactCents);
        if (cents === null) return res.status(400).json({ error: "Cost impact must be a whole number of cents." });
        updates.push(`cost_impact_cents = $${i}`); values.push(cents); i++;
      }
      if (req.body.categoryId !== undefined) {
        if (!req.body.categoryId) return res.status(400).json({ error: "A target category is required." });
        const cat = await pool.query(
          "SELECT 1 FROM budget_categories WHERE id = $1 AND project_id = $2",
          [req.body.categoryId, co.project_id]
        );
        if (cat.rows.length === 0) {
          return res.status(400).json({ error: "That category doesn't belong to this project." });
        }
        updates.push(`category_id = $${i}`); values.push(req.body.categoryId); i++;
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "No valid fields provided to update." });
      }
      values.push(req.params.id);
      await pool.query(
        `UPDATE change_orders SET ${updates.join(", ")} WHERE id = $${i}`,
        values
      );
      const updated = await fetchChangeOrder(req.params.id);
      res.json({ changeOrder: updated });
    } catch (err) {
      console.error("[radah-pm] update change order error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// TRANSITION (the workflow engine)
// POST /api/change-orders/:id/transition   Body: { action }
//   action = submit | approve | reject | revert
// ============================================================
router.post("/change-orders/:id/transition", requireAuth, guardResource("change_orders"), async (req, res) => {
  const action = (req.body && req.body.action) || "";
  const valid = ["submit", "approve", "reject", "revert"];
  if (!valid.includes(action)) {
    return res.status(400).json({ error: "Unknown action." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cur = await client.query("SELECT * FROM change_orders WHERE id = $1 FOR UPDATE", [
      req.params.id,
    ]);
    const co = cur.rows[0];
    if (!co) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Change order not found." });
    }

    // Trade partners never touch change orders.
    if (req.user.role === "trade_partner") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "You do not have access to change orders." });
    }

    const internal = isInternal(req.user);
    // Non-internal users must be a member of the CO's project.
    if (!internal) {
      const member = await client.query(
        "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
        [co.project_id, req.user.id]
      );
      if (member.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "You do not have access to this project." });
      }
    }

    // --- Action rules ---
    if (action === "submit") {
      if (!internal) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Only RADAH staff can submit a change order." }); }
      if (co.status !== "draft") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only draft change orders can be submitted." }); }
      await client.query(
        "UPDATE change_orders SET status = 'submitted', submitted_by = $1, submitted_at = now() WHERE id = $2",
        [req.user.id, co.id]
      );

    } else if (action === "reject") {
      // admin/staff OR project-member client
      if (co.status !== "submitted") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only submitted change orders can be rejected." }); }
      await client.query(
        "UPDATE change_orders SET status = 'rejected', decided_by = $1, decided_at = now() WHERE id = $2",
        [req.user.id, co.id]
      );

    } else if (action === "approve") {
      if (co.status !== "submitted") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only submitted change orders can be approved." }); }
      if (!co.category_id) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This change order's target category no longer exists. Edit it and pick a category before approving." });
      }
      const lineDescription = `CO #${co.co_number}: ${co.title}`;

      if (co.budget_line_id) {
        // Restore a previously-reverted line (un-flag + reset amount). Idempotent.
        const upd = await client.query(
          `UPDATE budget_lines
              SET description = $1, budgeted_amount_cents = $2, category_id = $3
            WHERE id = $4
            RETURNING id`,
          [lineDescription, co.cost_impact_cents, co.category_id, co.budget_line_id]
        );
        if (upd.rows.length === 0) {
          // The linked line was deleted out from under us — create a fresh one.
          const created = await client.query(
            `INSERT INTO budget_lines (project_id, category_id, description, budgeted_amount_cents)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [co.project_id, co.category_id, lineDescription, co.cost_impact_cents]
          );
          await client.query("UPDATE change_orders SET budget_line_id = $1 WHERE id = $2", [
            created.rows[0].id, co.id,
          ]);
        }
      } else {
        const created = await client.query(
          `INSERT INTO budget_lines (project_id, category_id, description, budgeted_amount_cents)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [co.project_id, co.category_id, lineDescription, co.cost_impact_cents]
        );
        await client.query("UPDATE change_orders SET budget_line_id = $1 WHERE id = $2", [
          created.rows[0].id, co.id,
        ]);
      }
      await client.query(
        "UPDATE change_orders SET status = 'approved', decided_by = $1, decided_at = now() WHERE id = $2",
        [req.user.id, co.id]
      );

    } else if (action === "revert") {
      if (!internal) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Only RADAH staff can revert a change order." }); }
      if (co.status !== "approved") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only approved change orders can be reverted." }); }
      // Flag (don't delete) the linked budget line and zero its effect.
      if (co.budget_line_id) {
        await client.query(
          `UPDATE budget_lines
              SET description = $1, budgeted_amount_cents = 0
            WHERE id = $2`,
          [`[REVERTED] CO #${co.co_number}: ${co.title}`, co.budget_line_id]
        );
      }
      await client.query(
        "UPDATE change_orders SET status = 'submitted', decided_by = NULL, decided_at = NULL WHERE id = $1",
        [co.id]
      );
    }

    await client.query("COMMIT");
    const updated = await fetchChangeOrder(req.params.id);

    // Trade partners have no access to change orders, so they're never told.
    const NOTIFY = {
      submit: { type: "changeorder.submitted", verb: "submitted for decision" },
      approve: { type: "changeorder.approved", verb: "approved" },
      reject: { type: "changeorder.rejected", verb: "rejected" },
    };
    if (NOTIFY[action]) {
      await notifyProject({
        projectId: co.project_id,
        orgId: req.user.orgId,
        actorId: req.user.id,
        actorName: req.user.fullName,
        type: NOTIFY[action].type,
        title: `CO #${updated.coNumber} ${NOTIFY[action].verb}: ${updated.title}`,
        body: `${req.user.fullName || "Someone"} ${NOTIFY[action].verb} this change order.`,
        tab: "changeorders",
        excludeRoles: ["trade_partner"],
      });
    }
    res.json({ changeOrder: updated });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[radah-pm] change order transition error:", err);
    res.status(500).json({ error: "Something went wrong processing that action." });
  } finally {
    client.release();
  }
});

// ============================================================
// DELETE (admin/staff only)
// Leaves any linked budget line intact (history is preserved).
// ============================================================
router.delete(
  "/change-orders/:id",
  requireAuth,
  requireRole("admin"),
  guardResource("change_orders"),
  async (req, res) => {
    try {
      const r = await pool.query(
        "UPDATE change_orders SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id",
        [req.user.id, req.params.id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Change order not found." });
      res.json({ message: "Change order moved to Deleted Items. An admin can restore it." });
    } catch (err) {
      console.error("[radah-pm] delete change order error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// ATTACHMENTS (supporting docs) — reuse the Documents R2 pipeline.
// admin/staff or a project-member client may attach; trade partners cannot.
// Attachments are also normal project documents.
// ============================================================

// POST /api/projects/:projectId/change-orders/:coId/attachments/upload-url
router.post(
  "/projects/:projectId/change-orders/:coId/attachments/upload-url",
  requireAuth,
  requireR2,
  guardProject,
  async (req, res) => {
    try {
      const co = await pool.query(
        "SELECT id, project_id FROM change_orders WHERE id = $1",
        [req.params.coId]
      );
      if (!co.rows[0] || co.rows[0].project_id !== req.params.projectId) {
        return res.status(404).json({ error: "Change order not found." });
      }
      if (!(await canAttachCO(req.user, req.params.projectId))) {
        return res.status(403).json({ error: "You can't attach files to change orders on this project." });
      }
      const { fileName, contentType } = req.body || {};
      if (!fileName) return res.status(400).json({ error: "fileName is required." });
      const storageKey = buildStorageKey(req.params.projectId, fileName);
      const uploadUrl = await r2.getUploadUrl(storageKey, contentType);
      res.json({ uploadUrl, storageKey });
    } catch (err) {
      console.error("[radah-pm] CO attachment upload-url error:", err);
      res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
  }
);

// POST /api/projects/:projectId/change-orders/:coId/attachments/confirm
router.post(
  "/projects/:projectId/change-orders/:coId/attachments/confirm",
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
      const co = await pool.query(
        "SELECT id, project_id FROM change_orders WHERE id = $1",
        [req.params.coId]
      );
      if (!co.rows[0] || co.rows[0].project_id !== req.params.projectId) {
        client.release();
        return res.status(404).json({ error: "Change order not found." });
      }
      if (!(await canAttachCO(req.user, req.params.projectId))) {
        client.release();
        return res.status(403).json({ error: "You can't attach files to change orders on this project." });
      }

      await client.query("BEGIN");
      const docRes = await client.query(
        `INSERT INTO documents (project_id, storage_key, file_name, content_type, size_bytes, description, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          req.params.projectId,
          storageKey,
          fileName,
          contentType || null,
          sizeBytes || null,
          `Change order attachment`,
          req.user.id,
        ]
      );
      const documentId = docRes.rows[0].id;
      const linkRes = await client.query(
        `INSERT INTO change_order_documents (change_order_id, document_id) VALUES ($1, $2) RETURNING id`,
        [req.params.coId, documentId]
      );
      await client.query("COMMIT");
      res.status(201).json({
        attachment: { id: linkRes.rows[0].id, documentId, fileName, canDelete: true },
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[radah-pm] CO attachment confirm error:", err);
      res.status(500).json({ error: "Could not save the attachment." });
    } finally {
      client.release();
    }
  }
);

// DELETE /api/change-order-documents/:id — uploader or admin/staff (detach only).
router.delete("/change-order-documents/:id", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cod.id, d.uploaded_by, d.project_id
         FROM change_order_documents cod JOIN documents d ON d.id = cod.document_id
        WHERE cod.id = $1`,
      [req.params.id]
    );
    const link = r.rows[0];
    if (!link) return res.status(404).json({ error: "Attachment not found." });
    if (!(await userCanAccessProject(req.user, link.project_id))) {
      return res.status(404).json({ error: "Attachment not found." });
    }
    const canDelete = isInternal(req.user) || link.uploaded_by === req.user.id;
    if (!canDelete) {
      return res.status(403).json({ error: "Only the uploader or RADAH staff can remove this attachment." });
    }
    await pool.query("DELETE FROM change_order_documents WHERE id = $1", [req.params.id]);
    res.json({ message: "Attachment removed." });
  } catch (err) {
    console.error("[radah-pm] delete CO attachment error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

module.exports = router;
