// src/components/BudgetTab.jsx
//
// Per-project budget & cost tracking.
//   Budgeted / Committed / Actual / Remaining rollup per line, grouped by
//   category, with commitments and expenses as per-line drill-downs.
//
// admin/staff: full edit.  client: read-only.  trade_partner: never sees this
// tab (hidden in ProjectDetailPage and blocked by the backend).

import { useEffect, useState, useCallback, Fragment } from "react";
import { api } from "../api/client";

// ---------- money helpers (UI works in dollars; API works in cents) ----------
function fmtMoney(cents) {
  const n = Number(cents) || 0;
  const neg = n < 0;
  const abs = Math.abs(n) / 100;
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? "-$" : "$") + s;
}
function centsToDollarInput(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2);
}
function dollarsToCents(str) {
  const cleaned = String(str).replace(/[^0-9.]/g, "");
  if (cleaned === "") return 0;
  const n = Math.round(parseFloat(cleaned) * 100);
  return Number.isFinite(n) ? n : NaN;
}

const inputStyle = {
  width: "100%",
  border: "1.5px solid var(--line)",
  borderRadius: "6px",
  padding: "0.55rem 0.8rem",
  fontSize: "0.88rem",
};
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };

// ============================================================
// Line modal (add / edit a budget line)
// ============================================================
function LineModal({ projectId, categories, line, onClose, onSaved }) {
  const isEdit = Boolean(line);
  const [form, setForm] = useState({
    categoryId: line?.categoryId || "",
    description: line?.description || "",
    budgeted: line ? centsToDollarInput(line.budgetedCents) : "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.description.trim()) return setError("Please enter a description.");
    const cents = dollarsToCents(form.budgeted || "0");
    if (Number.isNaN(cents) || cents < 0) return setError("Enter a valid budget amount.");
    setSaving(true);
    try {
      const payload = {
        categoryId: form.categoryId || null,
        description: form.description.trim(),
        budgetedCents: cents,
      };
      if (isEdit) {
        await api.patch(`/budget-lines/${line.id}`, payload);
      } else {
        await api.post(`/projects/${projectId}/budget/lines`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{isEdit ? "Edit Budget Line" : "New Budget Line"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Category</label>
            <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} style={inputStyle}>
              <option value="">Uncategorized</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Description</label>
            <input autoFocus value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={inputStyle} placeholder="e.g. Site electrical rough-in" />
          </div>
          <div style={{ marginBottom: "1.4rem" }}>
            <label style={labelStyle}>Budgeted Amount ($)</label>
            <input value={form.budgeted} onChange={(e) => setForm((f) => ({ ...f, budgeted: e.target.value }))} style={inputStyle} placeholder="0.00" inputMode="decimal" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save" : "Add Line"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Commitment modal (add / edit a PO / subcontract on a line)
// ============================================================
function CommitmentModal({ projectId, line, commitment, onClose, onSaved }) {
  const isEdit = Boolean(commitment);
  const [form, setForm] = useState({
    vendorName: commitment?.vendorName || "",
    description: commitment?.description || "",
    amount: commitment ? centsToDollarInput(commitment.committedCents) : "",
    status: commitment?.status || "open",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    const cents = dollarsToCents(form.amount || "0");
    if (Number.isNaN(cents) || cents < 0) return setError("Enter a valid amount.");
    setSaving(true);
    try {
      const payload = {
        budgetLineId: line.id,
        vendorName: form.vendorName.trim() || null,
        description: form.description.trim() || null,
        committedCents: cents,
        status: form.status,
      };
      if (isEdit) {
        await api.patch(`/budget-commitments/${commitment.id}`, payload);
      } else {
        await api.post(`/projects/${projectId}/budget/commitments`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{isEdit ? "Edit Commitment" : "New Commitment (PO / Subcontract)"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>On line: <strong>{line.description}</strong></p>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Vendor / Subcontractor</label>
            <input autoFocus value={form.vendorName} onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))} style={inputStyle} placeholder="e.g. Acme Electric" />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Description</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={inputStyle} placeholder="e.g. PO #1042" />
          </div>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1.4rem" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Committed Amount ($)</label>
              <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={inputStyle} placeholder="0.00" inputMode="decimal" />
            </div>
            <div style={{ width: 140 }}>
              <label style={labelStyle}>Status</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={inputStyle}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
          <p className="text-sm text-steel" style={{ marginBottom: "1.2rem" }}>Only <strong>open</strong> commitments count toward the committed total.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save" : "Add Commitment"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Expense modal (add / edit an actual cost on a line)
// ============================================================
function ExpenseModal({ projectId, line, lineCommitments, expense, onClose, onSaved }) {
  const isEdit = Boolean(expense);
  const [form, setForm] = useState({
    vendorName: expense?.vendorName || "",
    description: expense?.description || "",
    amount: expense ? centsToDollarInput(expense.amountCents) : "",
    expenseDate: expense?.expenseDate ? String(expense.expenseDate).slice(0, 10) : "",
    commitmentId: expense?.commitmentId || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    const cents = dollarsToCents(form.amount || "0");
    if (Number.isNaN(cents) || cents < 0) return setError("Enter a valid amount.");
    setSaving(true);
    try {
      const payload = {
        budgetLineId: line.id,
        commitmentId: form.commitmentId || null,
        vendorName: form.vendorName.trim() || null,
        description: form.description.trim() || null,
        amountCents: cents,
        expenseDate: form.expenseDate || null,
      };
      if (isEdit) {
        await api.patch(`/budget-expenses/${expense.id}`, payload);
      } else {
        await api.post(`/projects/${projectId}/budget/expenses`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{isEdit ? "Edit Expense" : "Log Expense"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>On line: <strong>{line.description}</strong></p>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Vendor / Payee</label>
            <input autoFocus value={form.vendorName} onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))} style={inputStyle} placeholder="e.g. Acme Electric" />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Description</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={inputStyle} placeholder="e.g. Invoice #556" />
          </div>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Amount ($)</label>
              <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={inputStyle} placeholder="0.00" inputMode="decimal" />
            </div>
            <div style={{ width: 170 }}>
              <label style={labelStyle}>Date</label>
              <input type="date" value={form.expenseDate} onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          {lineCommitments.length > 0 && (
            <div style={{ marginBottom: "1.4rem" }}>
              <label style={labelStyle}>Against Commitment (optional)</label>
              <select value={form.commitmentId} onChange={(e) => setForm((f) => ({ ...f, commitmentId: e.target.value }))} style={inputStyle}>
                <option value="">None</option>
                {lineCommitments.map((c) => (
                  <option key={c.id} value={c.id}>{(c.vendorName || "Commitment")} — {fmtMoney(c.committedCents)} ({c.status})</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save" : "Log Expense"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Small stacked bar showing committed + actual against budget
// ============================================================
function UsageBar({ budgeted, committed, actual }) {
  const denom = budgeted > 0 ? budgeted : committed + actual;
  if (denom <= 0) return null;
  const actualPct = Math.min(100, (actual / denom) * 100);
  const committedPct = Math.min(100 - actualPct, (committed / denom) * 100);
  const over = actual + committed > budgeted && budgeted > 0;
  return (
    <div style={{ height: 6, background: "var(--line)", borderRadius: 3, overflow: "hidden", display: "flex", marginTop: 4 }}>
      <div style={{ width: `${actualPct}%`, background: over ? "var(--red)" : "var(--green-deep, #2E9E5B)" }} />
      <div style={{ width: `${committedPct}%`, background: "var(--gold)" }} />
    </div>
  );
}

// ============================================================
// Main Budget tab
// ============================================================
export default function BudgetTab({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [lineModal, setLineModal] = useState(null);       // null | {} | line
  const [commitmentModal, setCommitmentModal] = useState(null); // null | {line} | {line, commitment}
  const [expenseModal, setExpenseModal] = useState(null); // null | {line} | {line, expense}
  const [showCats, setShowCats] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get(`/projects/${projectId}/budget`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const canEdit = data?.canEdit;

  async function seedDefaults() {
    setSeeding(true);
    try {
      await api.post(`/projects/${projectId}/budget/seed-defaults`, {});
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSeeding(false);
    }
  }

  async function addCategory(e) {
    e.preventDefault();
    if (!newCat.trim()) return;
    try {
      await api.post(`/projects/${projectId}/budget/categories`, { name: newCat.trim() });
      setNewCat("");
      await load();
    } catch (err) { alert(err.message); }
  }

  async function deleteCategory(cat) {
    if (!confirm(`Delete category "${cat.name}"?`)) return;
    try {
      await api.delete(`/budget-categories/${cat.id}`);
      await load();
    } catch (err) { alert(err.message); }
  }

  async function deleteLine(line) {
    if (!confirm(`Delete budget line "${line.description}"? Commitments and expenses on it are kept but become unassigned.`)) return;
    try { await api.delete(`/budget-lines/${line.id}`); await load(); }
    catch (err) { alert(err.message); }
  }

  async function deleteCommitment(c) {
    if (!confirm("Delete this commitment?")) return;
    try { await api.delete(`/budget-commitments/${c.id}`); await load(); }
    catch (err) { alert(err.message); }
  }

  async function deleteExpense(x) {
    if (!confirm("Delete this expense?")) return;
    try { await api.delete(`/budget-expenses/${x.id}`); await load(); }
    catch (err) { alert(err.message); }
  }

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const { categories, lines, commitments, expenses, totals } = data;
  const hasBudget = categories.length > 0 || lines.length > 0;

  // Empty state
  if (!hasBudget) {
    return (
      <div className="card">
        <div className="empty-state">
          <h3>No budget set up yet</h3>
          {canEdit ? (
            <>
              <p className="text-sm">Start with a standard set of construction cost categories, then add budget lines.</p>
              <button className="btn btn-gold" style={{ marginTop: "1rem" }} onClick={seedDefaults} disabled={seeding}>
                {seeding ? "Setting up..." : "Set Up Budget"}
              </button>
            </>
          ) : (
            <p className="text-sm">A budget hasn't been set up for this project yet.</p>
          )}
        </div>
      </div>
    );
  }

  // Group lines by category (in category order), with an Uncategorized bucket last.
  const groups = categories.map((c) => ({
    category: c,
    lines: lines.filter((l) => l.categoryId === c.id),
  }));
  const uncategorized = lines.filter((l) => !l.categoryId);
  if (uncategorized.length > 0) {
    groups.push({ category: { id: "__uncat__", name: "Uncategorized" }, lines: uncategorized });
  }

  const commitmentsForLine = (lineId) => commitments.filter((c) => c.budgetLineId === lineId);
  const expensesForLine = (lineId) => expenses.filter((x) => x.budgetLineId === lineId);

  function subtotal(groupLines, key) {
    return groupLines.reduce((s, l) => s + l[key], 0);
  }

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "1.4rem" }}>
        <div className="stat-card"><div className="value" style={{ fontSize: "1.35rem", fontWeight: 700 }}>{fmtMoney(totals.budgetedCents)}</div><div className="label">Budgeted</div></div>
        <div className="stat-card"><div className="value" style={{ fontSize: "1.35rem", fontWeight: 700, color: "var(--gold)" }}>{fmtMoney(totals.committedCents)}</div><div className="label">Committed</div></div>
        <div className="stat-card"><div className="value" style={{ fontSize: "1.35rem", fontWeight: 700 }}>{fmtMoney(totals.actualCents)}</div><div className="label">Actual Spent</div></div>
        <div className="stat-card"><div className="value" style={{ fontSize: "1.35rem", fontWeight: 700, color: totals.remainingCents < 0 ? "var(--red)" : "inherit" }}>{fmtMoney(totals.remainingCents)}</div><div className="label">Remaining</div></div>
      </div>

      {canEdit && (
        <div className="flex-between" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.6rem" }}>
          <button className="btn btn-outline btn-sm" onClick={() => setShowCats((s) => !s)}>{showCats ? "Hide Categories" : "Manage Categories"}</button>
          <button className="btn btn-gold" onClick={() => setLineModal({})}>+ Add Budget Line</button>
        </div>
      )}

      {canEdit && showCats && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "0.9rem", textTransform: "uppercase", marginBottom: "0.8rem" }}>Categories</h3>
          <form onSubmit={addCategory} style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem" }}>
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" style={{ ...inputStyle, flex: 1 }} />
            <button className="btn btn-outline btn-sm">+ Add</button>
          </form>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {categories.map((c) => (
              <span key={c.id} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", background: "rgba(11,31,58,0.06)", color: "var(--navy)" }}>
                {c.name}
                <button onClick={() => deleteCategory(c)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--steel)", fontSize: "1rem", lineHeight: 1 }} title="Delete category">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Grouped line table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Line</th>
              <th style={{ textAlign: "right" }}>Budgeted</th>
              <th style={{ textAlign: "right" }}>Committed</th>
              <th style={{ textAlign: "right" }}>Actual</th>
              <th style={{ textAlign: "right" }}>Remaining</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows
                key={g.category.id}
                group={g}
                canEdit={canEdit}
                expanded={expanded}
                setExpanded={setExpanded}
                commitmentsForLine={commitmentsForLine}
                expensesForLine={expensesForLine}
                subtotal={subtotal}
                onEditLine={(l) => setLineModal(l)}
                onDeleteLine={deleteLine}
                onAddCommitment={(l) => setCommitmentModal({ line: l })}
                onEditCommitment={(l, c) => setCommitmentModal({ line: l, commitment: c })}
                onDeleteCommitment={deleteCommitment}
                onAddExpense={(l) => setExpenseModal({ line: l })}
                onEditExpense={(l, x) => setExpenseModal({ line: l, expense: x })}
                onDeleteExpense={deleteExpense}
              />
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={canEdit ? 7 : 6} style={{ textAlign: "center", color: "var(--steel)", padding: "1.5rem" }}>No budget lines yet. {canEdit && "Use “+ Add Budget Line” to start."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {lineModal !== null && (
        <LineModal
          projectId={projectId}
          categories={categories}
          line={lineModal.id ? lineModal : null}
          onClose={() => setLineModal(null)}
          onSaved={() => { setLineModal(null); load(); }}
        />
      )}
      {commitmentModal !== null && (
        <CommitmentModal
          projectId={projectId}
          line={commitmentModal.line}
          commitment={commitmentModal.commitment || null}
          onClose={() => setCommitmentModal(null)}
          onSaved={() => { setCommitmentModal(null); load(); }}
        />
      )}
      {expenseModal !== null && (
        <ExpenseModal
          projectId={projectId}
          line={expenseModal.line}
          lineCommitments={commitmentsForLine(expenseModal.line.id)}
          expense={expenseModal.expense || null}
          onClose={() => setExpenseModal(null)}
          onSaved={() => { setExpenseModal(null); load(); }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Rows for a single category group (subheader + its lines + drill-downs)
// ------------------------------------------------------------
function GroupRows({
  group, canEdit, expanded, setExpanded,
  commitmentsForLine, expensesForLine, subtotal,
  onEditLine, onDeleteLine,
  onAddCommitment, onEditCommitment, onDeleteCommitment,
  onAddExpense, onEditExpense, onDeleteExpense,
}) {
  const colCount = canEdit ? 7 : 6;
  return (
    <>
      <tr style={{ background: "rgba(11,31,58,0.03)" }}>
        <td></td>
        <td style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "0.78rem", letterSpacing: "0.03em", color: "var(--steel)" }}>{group.category.name}</td>
        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(subtotal(group.lines, "budgetedCents"))}</td>
        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(subtotal(group.lines, "committedCents"))}</td>
        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(subtotal(group.lines, "actualCents"))}</td>
        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(subtotal(group.lines, "remainingCents"))}</td>
        {canEdit && <td></td>}
      </tr>
      {group.lines.map((l) => {
        const isOpen = expanded === l.id;
        const lineCommitments = commitmentsForLine(l.id);
        const lineExpenses = expensesForLine(l.id);
        return (
          <Fragment key={l.id}>
            <tr className="clickable" onClick={() => setExpanded(isOpen ? null : l.id)}>
              <td style={{ textAlign: "center", color: "var(--steel)" }}>{isOpen ? "▾" : "▸"}</td>
              <td>
                <strong>{l.description}</strong>
                <UsageBar budgeted={l.budgetedCents} committed={l.committedCents} actual={l.actualCents} />
              </td>
              <td style={{ textAlign: "right" }}>{fmtMoney(l.budgetedCents)}</td>
              <td style={{ textAlign: "right", color: "var(--gold)" }}>{fmtMoney(l.committedCents)}</td>
              <td style={{ textAlign: "right" }}>{fmtMoney(l.actualCents)}</td>
              <td style={{ textAlign: "right", color: l.remainingCents < 0 ? "var(--red)" : "inherit", fontWeight: 600 }}>{fmtMoney(l.remainingCents)}</td>
              {canEdit && (
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                    <button className="btn btn-outline btn-sm" onClick={() => onEditLine(l)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => onDeleteLine(l)}>Delete</button>
                  </div>
                </td>
              )}
            </tr>
            {isOpen && (
              <tr>
                <td colSpan={colCount} style={{ background: "rgba(11,31,58,0.02)", padding: "1rem 1.2rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.4rem" }}>
                    {/* Commitments */}
                    <div>
                      <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                        <strong style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--steel)" }}>Commitments (POs / Subs)</strong>
                        {canEdit && <button className="btn btn-outline btn-sm" onClick={() => onAddCommitment(l)}>+ Add</button>}
                      </div>
                      {lineCommitments.length === 0 ? (
                        <p className="text-sm text-steel">None.</p>
                      ) : lineCommitments.map((c) => (
                        <div key={c.id} className="flex-between" style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--line)", gap: "0.5rem" }}>
                          <div style={{ fontSize: "0.84rem" }}>
                            <strong>{c.vendorName || "—"}</strong>{c.description ? ` · ${c.description}` : ""}
                            <span className={`badge badge-${c.status === "open" ? "in_progress" : "completed"}`} style={{ marginLeft: "0.4rem" }}>{c.status}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontSize: "0.84rem", color: "var(--gold)" }}>{fmtMoney(c.committedCents)}</span>
                            {canEdit && <button className="btn btn-outline btn-sm" onClick={() => onEditCommitment(l, c)}>Edit</button>}
                            {canEdit && <button className="btn btn-danger btn-sm" onClick={() => onDeleteCommitment(c)}>×</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Expenses */}
                    <div>
                      <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                        <strong style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--steel)" }}>Expenses (Actuals)</strong>
                        {canEdit && <button className="btn btn-outline btn-sm" onClick={() => onAddExpense(l)}>+ Add</button>}
                      </div>
                      {lineExpenses.length === 0 ? (
                        <p className="text-sm text-steel">None.</p>
                      ) : lineExpenses.map((x) => (
                        <div key={x.id} className="flex-between" style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--line)", gap: "0.5rem" }}>
                          <div style={{ fontSize: "0.84rem" }}>
                            <strong>{x.vendorName || "—"}</strong>{x.description ? ` · ${x.description}` : ""}
                            {x.expenseDate && <span className="text-steel"> · {new Date(x.expenseDate).toLocaleDateString()}</span>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontSize: "0.84rem" }}>{fmtMoney(x.amountCents)}</span>
                            {canEdit && <button className="btn btn-outline btn-sm" onClick={() => onEditExpense(l, x)}>Edit</button>}
                            {canEdit && <button className="btn btn-danger btn-sm" onClick={() => onDeleteExpense(x)}>×</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
