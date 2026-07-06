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
const pool = require("../db/pool");
const { requireAuth, requireRole, isInternal } = require("../middleware/auth");
const { userCanAccessProject } = require("./projects");

const router = express.Router();

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
router.get("/projects/:projectId/change-orders", requireAuth, async (req, res) => {
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
          WHERE co.project_id = $1
          ORDER BY co.co_number DESC`,
        [req.params.projectId]
      ),
      pool.query(
        "SELECT id, name FROM budget_categories WHERE project_id = $1 ORDER BY sort_order ASC, name ASC",
        [req.params.projectId]
      ),
    ]);
    res.json({
      canManage: isInternal(req.user),
      canDecide: true, // both internal users and project-member clients may decide submitted COs
      categories: catsRes.rows.map((r) => ({ id: r.id, name: r.name })),
      changeOrders: cosRes.rows.map(mapChangeOrder),
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
router.post("/change-orders/:id/transition", requireAuth, async (req, res) => {
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
  requireRole("admin", "staff"),
  async (req, res) => {
    try {
      const r = await pool.query("DELETE FROM change_orders WHERE id = $1 RETURNING id", [
        req.params.id,
      ]);
      if (r.rows.length === 0) return res.status(404).json({ error: "Change order not found." });
      res.json({ message: "Change order deleted." });
    } catch (err) {
      console.error("[radah-pm] delete change order error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

module.exports = router;
