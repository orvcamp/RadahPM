// backend/routes/budget.js
//
// Per-project budgets & cost tracking.
//
// Three layers per project:
//   - budget_lines       : the plan (a budgeted amount per line, in a category)
//   - budget_commitments : POs / subcontracts (money obligated but not yet spent)
//   - budget_expenses    : actuals (costs incurred, each tied to a line)
//
// Rollup per line / category / project:
//   Budgeted / Committed (sum of OPEN commitments) / Actual (sum of expenses) /
//   Remaining (= budgeted - committed - actual).
//
// Visibility:
//   - admin/staff : full read + write (lines, commitments, expenses, categories)
//   - client      : read-only, for projects they belong to
//   - trade_partner: no budget access at all (403), even on their own projects
//
// All money is INTEGER CENTS (BIGINT in the DB, Number in JSON). The frontend
// converts to/from dollars.

const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requireRole } = require("../middleware/auth");
const { userCanAccessProject, resourceProjectId } = require("./projects");

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

const DEFAULT_CATEGORIES = ["Labor", "Materials", "Permits", "Equipment", "Subcontractor", "Other"];

// ---------- mappers (snake_case row -> camelCase) ----------
function centsOf(v) {
  return v === null || v === undefined ? 0 : Number(v);
}

function mapCategory(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

function mapLine(row) {
  const budgeted = centsOf(row.budgeted_amount_cents);
  const committed = centsOf(row.committed_cents);
  const actual = centsOf(row.actual_cents);
  return {
    id: row.id,
    projectId: row.project_id,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    description: row.description,
    budgetedCents: budgeted,
    committedCents: committed,
    actualCents: actual,
    remainingCents: budgeted - committed - actual,
    sortOrder: row.sort_order,
  };
}

function mapCommitment(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    budgetLineId: row.budget_line_id,
    vendorName: row.vendor_name,
    description: row.description,
    committedCents: centsOf(row.committed_amount_cents),
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapExpense(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    budgetLineId: row.budget_line_id,
    commitmentId: row.commitment_id,
    vendorName: row.vendor_name,
    description: row.description,
    amountCents: centsOf(row.amount_cents),
    expenseDate: row.expense_date,
    createdAt: row.created_at,
  };
}

// ---------- validation helpers ----------
// Accepts a non-negative safe integer number of cents. Returns null if invalid.
function normalizeCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return n;
}

// Confirms a budget line exists and belongs to the given project.
async function lineBelongsToProject(lineId, projectId) {
  const r = await pool.query(
    "SELECT 1 FROM budget_lines WHERE id = $1 AND project_id = $2",
    [lineId, projectId]
  );
  return r.rows.length > 0;
}

// ============================================================
// READ — full budget payload for a project
// GET /api/projects/:projectId/budget
// Any project member EXCEPT trade partners.
// ============================================================
router.get("/projects/:projectId/budget", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "trade_partner") {
      return res.status(403).json({ error: "You do not have access to project budgets." });
    }
    const allowed = await userCanAccessProject(req.user, req.params.projectId);
    if (!allowed) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }
    const projectId = req.params.projectId;

    const [catsRes, linesRes, commitmentsRes, expensesRes] = await Promise.all([
      pool.query(
        "SELECT * FROM budget_categories WHERE project_id = $1 ORDER BY sort_order ASC, name ASC",
        [projectId]
      ),
      pool.query(
        `SELECT l.*, c.name AS category_name,
                COALESCE(cm.committed, 0) AS committed_cents,
                COALESCE(ex.actual, 0) AS actual_cents
           FROM budget_lines l
           LEFT JOIN budget_categories c ON c.id = l.category_id
           LEFT JOIN (
             SELECT budget_line_id, SUM(committed_amount_cents) AS committed
               FROM budget_commitments
              WHERE status = 'open' AND budget_line_id IS NOT NULL
              GROUP BY budget_line_id
           ) cm ON cm.budget_line_id = l.id
           LEFT JOIN (
             SELECT budget_line_id, SUM(amount_cents) AS actual
               FROM budget_expenses
              WHERE budget_line_id IS NOT NULL
              GROUP BY budget_line_id
           ) ex ON ex.budget_line_id = l.id
          WHERE l.project_id = $1
          ORDER BY l.sort_order ASC, l.created_at ASC`,
        [projectId]
      ),
      pool.query(
        "SELECT * FROM budget_commitments WHERE project_id = $1 ORDER BY created_at DESC",
        [projectId]
      ),
      pool.query(
        "SELECT * FROM budget_expenses WHERE project_id = $1 ORDER BY expense_date DESC NULLS LAST, created_at DESC",
        [projectId]
      ),
    ]);

    const lines = linesRes.rows.map(mapLine);
    const totals = lines.reduce(
      (acc, l) => {
        acc.budgetedCents += l.budgetedCents;
        acc.committedCents += l.committedCents;
        acc.actualCents += l.actualCents;
        return acc;
      },
      { budgetedCents: 0, committedCents: 0, actualCents: 0 }
    );
    totals.remainingCents = totals.budgetedCents - totals.committedCents - totals.actualCents;

    res.json({
      canEdit: req.user.role === "admin" || req.user.role === "staff",
      categories: catsRes.rows.map(mapCategory),
      lines,
      commitments: commitmentsRes.rows.map(mapCommitment),
      expenses: expensesRes.rows.map(mapExpense),
      totals,
    });
  } catch (err) {
    console.error("[radah-pm] get budget error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ============================================================
// CATEGORIES (admin/staff only)
// ============================================================

// Seed the default category set for a project (only if it has none yet).
// POST /api/projects/:projectId/budget/seed-defaults
router.post(
  "/projects/:projectId/budget/seed-defaults",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    try {
      const existing = await pool.query(
        "SELECT 1 FROM budget_categories WHERE project_id = $1 LIMIT 1",
        [req.params.projectId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: "This project already has budget categories." });
      }
      const inserted = [];
      for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
        const r = await pool.query(
          `INSERT INTO budget_categories (project_id, name, sort_order)
           VALUES ($1, $2, $3)
           ON CONFLICT (project_id, name) DO NOTHING
           RETURNING *`,
          [req.params.projectId, DEFAULT_CATEGORIES[i], i]
        );
        if (r.rows[0]) inserted.push(mapCategory(r.rows[0]));
      }
      res.status(201).json({ categories: inserted });
    } catch (err) {
      console.error("[radah-pm] seed budget categories error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// POST /api/projects/:projectId/budget/categories  { name, sortOrder }
router.post(
  "/projects/:projectId/budget/categories",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { name, sortOrder } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Category name is required." });
    }
    try {
      const r = await pool.query(
        `INSERT INTO budget_categories (project_id, name, sort_order)
         VALUES ($1, $2, COALESCE($3, 0))
         RETURNING *`,
        [req.params.projectId, name.trim(), sortOrder ?? null]
      );
      res.status(201).json({ category: mapCategory(r.rows[0]) });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "A category with that name already exists." });
      }
      console.error("[radah-pm] create budget category error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// PATCH /api/budget-categories/:id  { name, sortOrder }
router.patch(
  "/budget-categories/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("budget_categories"),
  async (req, res) => {
    const map = { name: "name", sortOrder: "sort_order" };
    const updates = [];
    const values = [];
    let i = 1;
    for (const [k, col] of Object.entries(map)) {
      if (req.body[k] !== undefined) {
        updates.push(`${col} = $${i}`);
        values.push(k === "name" ? String(req.body[k]).trim() : req.body[k]);
        i++;
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields provided to update." });
    }
    values.push(req.params.id);
    try {
      const r = await pool.query(
        `UPDATE budget_categories SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
        values
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Category not found." });
      res.json({ category: mapCategory(r.rows[0]) });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "A category with that name already exists." });
      }
      console.error("[radah-pm] update budget category error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// DELETE /api/budget-categories/:id
// Blocked if any budget lines still reference it (protects financial data).
router.delete(
  "/budget-categories/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("budget_categories"),
  async (req, res) => {
    try {
      const inUse = await pool.query(
        "SELECT 1 FROM budget_lines WHERE category_id = $1 LIMIT 1",
        [req.params.id]
      );
      if (inUse.rows.length > 0) {
        return res.status(409).json({
          error: "This category still has budget lines. Move or remove them first.",
        });
      }
      const r = await pool.query(
        "DELETE FROM budget_categories WHERE id = $1 RETURNING id",
        [req.params.id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Category not found." });
      res.json({ message: "Category deleted." });
    } catch (err) {
      console.error("[radah-pm] delete budget category error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// BUDGET LINES (admin/staff only)
// ============================================================

// POST /api/projects/:projectId/budget/lines
// Body: { categoryId, description, budgetedCents, sortOrder }
router.post(
  "/projects/:projectId/budget/lines",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { categoryId, description, budgetedCents, sortOrder } = req.body || {};
    if (!description || !description.trim()) {
      return res.status(400).json({ error: "A line description is required." });
    }
    const cents = normalizeCents(budgetedCents);
    if (cents === null) {
      return res.status(400).json({ error: "Budgeted amount must be a whole number of cents (>= 0)." });
    }
    try {
      // If a category was supplied, make sure it belongs to this project.
      if (categoryId) {
        const c = await pool.query(
          "SELECT 1 FROM budget_categories WHERE id = $1 AND project_id = $2",
          [categoryId, req.params.projectId]
        );
        if (c.rows.length === 0) {
          return res.status(400).json({ error: "That category doesn't belong to this project." });
        }
      }
      const r = await pool.query(
        `INSERT INTO budget_lines (project_id, category_id, description, budgeted_amount_cents, sort_order)
         VALUES ($1, $2, $3, $4, COALESCE($5, 0))
         RETURNING *`,
        [req.params.projectId, categoryId || null, description.trim(), cents, sortOrder ?? null]
      );
      // Re-map with category name for a consistent shape.
      const withCat = await pool.query(
        `SELECT l.*, c.name AS category_name, 0 AS committed_cents, 0 AS actual_cents
           FROM budget_lines l LEFT JOIN budget_categories c ON c.id = l.category_id
          WHERE l.id = $1`,
        [r.rows[0].id]
      );
      res.status(201).json({ line: mapLine(withCat.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create budget line error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// PATCH /api/budget-lines/:id
router.patch(
  "/budget-lines/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("budget_lines"),
  async (req, res) => {
    const updates = [];
    const values = [];
    let i = 1;

    if (req.body.description !== undefined) {
      if (!String(req.body.description).trim()) {
        return res.status(400).json({ error: "Description cannot be empty." });
      }
      updates.push(`description = $${i}`);
      values.push(String(req.body.description).trim());
      i++;
    }
    if (req.body.budgetedCents !== undefined) {
      const cents = normalizeCents(req.body.budgetedCents);
      if (cents === null) {
        return res.status(400).json({ error: "Budgeted amount must be a whole number of cents (>= 0)." });
      }
      updates.push(`budgeted_amount_cents = $${i}`);
      values.push(cents);
      i++;
    }
    if (req.body.categoryId !== undefined) {
      updates.push(`category_id = $${i}`);
      values.push(req.body.categoryId || null);
      i++;
    }
    if (req.body.sortOrder !== undefined) {
      updates.push(`sort_order = $${i}`);
      values.push(req.body.sortOrder);
      i++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields provided to update." });
    }
    values.push(req.params.id);

    try {
      // Validate a newly-assigned category belongs to the same project as the line.
      if (req.body.categoryId) {
        const chk = await pool.query(
          `SELECT 1 FROM budget_lines l
             JOIN budget_categories c ON c.project_id = l.project_id
            WHERE l.id = $1 AND c.id = $2`,
          [req.params.id, req.body.categoryId]
        );
        if (chk.rows.length === 0) {
          return res.status(400).json({ error: "That category doesn't belong to this project." });
        }
      }
      const r = await pool.query(
        `UPDATE budget_lines SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
        values
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Budget line not found." });
      const withRollup = await pool.query(
        `SELECT l.*, c.name AS category_name,
                COALESCE((SELECT SUM(committed_amount_cents) FROM budget_commitments
                           WHERE budget_line_id = l.id AND status = 'open'), 0) AS committed_cents,
                COALESCE((SELECT SUM(amount_cents) FROM budget_expenses
                           WHERE budget_line_id = l.id), 0) AS actual_cents
           FROM budget_lines l LEFT JOIN budget_categories c ON c.id = l.category_id
          WHERE l.id = $1`,
        [r.rows[0].id]
      );
      res.json({ line: mapLine(withRollup.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] update budget line error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// DELETE /api/budget-lines/:id
// Commitments/expenses on this line are kept (set line-less), not deleted.
router.delete(
  "/budget-lines/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("budget_lines"),
  async (req, res) => {
    try {
      const r = await pool.query("DELETE FROM budget_lines WHERE id = $1 RETURNING id", [
        req.params.id,
      ]);
      if (r.rows.length === 0) return res.status(404).json({ error: "Budget line not found." });
      res.json({ message: "Budget line deleted." });
    } catch (err) {
      console.error("[radah-pm] delete budget line error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// COMMITMENTS (admin/staff only)
// ============================================================

// POST /api/projects/:projectId/budget/commitments
// Body: { budgetLineId, vendorName, description, committedCents, status }
router.post(
  "/projects/:projectId/budget/commitments",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { budgetLineId, vendorName, description, committedCents, status } = req.body || {};
    if (!budgetLineId) {
      return res.status(400).json({ error: "A budget line is required for a commitment." });
    }
    const cents = normalizeCents(committedCents);
    if (cents === null) {
      return res.status(400).json({ error: "Committed amount must be a whole number of cents (>= 0)." });
    }
    if (status && status !== "open" && status !== "closed") {
      return res.status(400).json({ error: "Status must be 'open' or 'closed'." });
    }
    try {
      if (!(await lineBelongsToProject(budgetLineId, req.params.projectId))) {
        return res.status(400).json({ error: "That budget line doesn't belong to this project." });
      }
      const r = await pool.query(
        `INSERT INTO budget_commitments
           (project_id, budget_line_id, vendor_name, description, committed_amount_cents, status, created_by)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::commitment_status, 'open'::commitment_status), $7)
         RETURNING *`,
        [
          req.params.projectId,
          budgetLineId,
          vendorName || null,
          description || null,
          cents,
          status || null,
          req.user.id,
        ]
      );
      res.status(201).json({ commitment: mapCommitment(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create commitment error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// PATCH /api/budget-commitments/:id
router.patch(
  "/budget-commitments/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("budget_commitments"),
  async (req, res) => {
    const updates = [];
    const values = [];
    let i = 1;

    if (req.body.vendorName !== undefined) {
      updates.push(`vendor_name = $${i}`); values.push(req.body.vendorName || null); i++;
    }
    if (req.body.description !== undefined) {
      updates.push(`description = $${i}`); values.push(req.body.description || null); i++;
    }
    if (req.body.committedCents !== undefined) {
      const cents = normalizeCents(req.body.committedCents);
      if (cents === null) {
        return res.status(400).json({ error: "Committed amount must be a whole number of cents (>= 0)." });
      }
      updates.push(`committed_amount_cents = $${i}`); values.push(cents); i++;
    }
    if (req.body.status !== undefined) {
      if (req.body.status !== "open" && req.body.status !== "closed") {
        return res.status(400).json({ error: "Status must be 'open' or 'closed'." });
      }
      updates.push(`status = $${i}::commitment_status`); values.push(req.body.status); i++;
    }
    if (req.body.budgetLineId !== undefined) {
      updates.push(`budget_line_id = $${i}`); values.push(req.body.budgetLineId || null); i++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields provided to update." });
    }
    values.push(req.params.id);
    try {
      const r = await pool.query(
        `UPDATE budget_commitments SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
        values
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Commitment not found." });
      res.json({ commitment: mapCommitment(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] update commitment error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// DELETE /api/budget-commitments/:id
router.delete(
  "/budget-commitments/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("budget_commitments"),
  async (req, res) => {
    try {
      const r = await pool.query(
        "DELETE FROM budget_commitments WHERE id = $1 RETURNING id",
        [req.params.id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Commitment not found." });
      res.json({ message: "Commitment deleted." });
    } catch (err) {
      console.error("[radah-pm] delete commitment error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// ============================================================
// EXPENSES (admin/staff only)
// Every expense must attach to a budget line (enforced here).
// ============================================================

// POST /api/projects/:projectId/budget/expenses
// Body: { budgetLineId (required), commitmentId, vendorName, description, amountCents, expenseDate }
router.post(
  "/projects/:projectId/budget/expenses",
  requireAuth,
  requireRole("admin", "staff"),
  guardProject,
  async (req, res) => {
    const { budgetLineId, commitmentId, vendorName, description, amountCents, expenseDate } =
      req.body || {};
    if (!budgetLineId) {
      return res.status(400).json({ error: "An expense must be attached to a budget line." });
    }
    const cents = normalizeCents(amountCents);
    if (cents === null) {
      return res.status(400).json({ error: "Amount must be a whole number of cents (>= 0)." });
    }
    try {
      if (!(await lineBelongsToProject(budgetLineId, req.params.projectId))) {
        return res.status(400).json({ error: "That budget line doesn't belong to this project." });
      }
      // If a commitment is linked, confirm it belongs to the same project.
      if (commitmentId) {
        const cm = await pool.query(
          "SELECT 1 FROM budget_commitments WHERE id = $1 AND project_id = $2",
          [commitmentId, req.params.projectId]
        );
        if (cm.rows.length === 0) {
          return res.status(400).json({ error: "That commitment doesn't belong to this project." });
        }
      }
      const r = await pool.query(
        `INSERT INTO budget_expenses
           (project_id, budget_line_id, commitment_id, vendor_name, description, amount_cents, expense_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          req.params.projectId,
          budgetLineId,
          commitmentId || null,
          vendorName || null,
          description || null,
          cents,
          expenseDate || null,
          req.user.id,
        ]
      );
      res.status(201).json({ expense: mapExpense(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] create expense error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// PATCH /api/budget-expenses/:id
router.patch(
  "/budget-expenses/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("budget_expenses"),
  async (req, res) => {
    const updates = [];
    const values = [];
    let i = 1;

    if (req.body.vendorName !== undefined) {
      updates.push(`vendor_name = $${i}`); values.push(req.body.vendorName || null); i++;
    }
    if (req.body.description !== undefined) {
      updates.push(`description = $${i}`); values.push(req.body.description || null); i++;
    }
    if (req.body.amountCents !== undefined) {
      const cents = normalizeCents(req.body.amountCents);
      if (cents === null) {
        return res.status(400).json({ error: "Amount must be a whole number of cents (>= 0)." });
      }
      updates.push(`amount_cents = $${i}`); values.push(cents); i++;
    }
    if (req.body.expenseDate !== undefined) {
      updates.push(`expense_date = $${i}`); values.push(req.body.expenseDate || null); i++;
    }
    if (req.body.commitmentId !== undefined) {
      updates.push(`commitment_id = $${i}`); values.push(req.body.commitmentId || null); i++;
    }
    if (req.body.budgetLineId !== undefined) {
      if (!req.body.budgetLineId) {
        return res.status(400).json({ error: "An expense must stay attached to a budget line." });
      }
      updates.push(`budget_line_id = $${i}`); values.push(req.body.budgetLineId); i++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields provided to update." });
    }
    values.push(req.params.id);
    try {
      const r = await pool.query(
        `UPDATE budget_expenses SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
        values
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Expense not found." });
      res.json({ expense: mapExpense(r.rows[0]) });
    } catch (err) {
      console.error("[radah-pm] update expense error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

// DELETE /api/budget-expenses/:id
router.delete(
  "/budget-expenses/:id",
  requireAuth,
  requireRole("admin", "staff"),
  guardResource("budget_expenses"),
  async (req, res) => {
    try {
      const r = await pool.query(
        "DELETE FROM budget_expenses WHERE id = $1 RETURNING id",
        [req.params.id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: "Expense not found." });
      res.json({ message: "Expense deleted." });
    } catch (err) {
      console.error("[radah-pm] delete expense error:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  }
);

module.exports = router;
