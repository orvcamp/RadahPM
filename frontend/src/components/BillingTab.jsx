// src/components/BillingTab.jsx
//
// Pay applications (AIA G702/G703-style): a list view with one row per
// application, and a detail view per application showing the schedule of
// values line items, retention math, and lien waivers.
//
// admin/staff manage everything; clients (project members) can approve or
// reject SUBMITTED pay applications. trade_partner never sees this tab.

import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function fmtMoney(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function parseDollarsToCents(str) {
  const t = String(str).trim().replace(/[^0-9.]/g, "");
  if (t === "") return 0;
  const n = Math.round(parseFloat(t) * 100);
  return Number.isFinite(n) ? n : NaN;
}
function centsToInput(cents) {
  return (Number(cents) / 100 || 0).toFixed(2);
}
// "This Period" can be entered as a dollar amount or as a percent of that
// line's Scheduled Value — these keep the two representations in sync.
function percentFromDollarInput(dollarStr, scheduledValueCents) {
  if (!scheduledValueCents) return "0.00";
  const cents = parseDollarsToCents(dollarStr);
  if (Number.isNaN(cents)) return "0.00";
  return ((cents / scheduledValueCents) * 100).toFixed(2);
}
function dollarInputFromPercent(percentStr, scheduledValueCents) {
  const pct = parseFloat(String(percentStr).trim());
  if (!Number.isFinite(pct)) return "0.00";
  const cents = Math.round((pct / 100) * scheduledValueCents);
  return centsToInput(cents);
}

const STATUS_BADGE = {
  draft: "badge-not_started",
  submitted: "badge-in_progress",
  approved: "badge-active",
  rejected: "badge-cancelled",
  paid: "badge-completed",
};

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: "6px", padding: "0.55rem 0.8rem", fontSize: "0.88rem" };
const labelStyle = { display: "block", fontSize: "0.78rem", color: "var(--steel)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" };
const cardStyle = { marginBottom: "1rem" };
const statGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem" };
const statBox = { padding: "0.8rem 1rem", background: "var(--paper, #f7f6f2)", borderRadius: 8, border: "1px solid var(--line)" };
const statLabel = { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--steel)", marginBottom: "0.25rem" };
const statValue = { fontSize: "1.2rem", fontWeight: 700, color: "var(--navy, #0B1F3A)" };

function Stat({ label, value, emphasize }) {
  return (
    <div style={{ ...statBox, ...(emphasize ? { borderColor: "var(--gold, #C9A227)", background: "rgba(201,162,39,0.08)" } : {}) }}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
    </div>
  );
}

// ---------- create modal ----------
function NewPayAppModal({ onClose, onSaved, projectId }) {
  const [form, setForm] = useState({ periodStart: "", periodEnd: "", retentionPercent: "10" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    const retention = Number(form.retentionPercent);
    if (!Number.isFinite(retention) || retention < 0 || retention > 100) {
      return setError("Retention percent must be between 0 and 100.");
    }
    setSaving(true);
    try {
      const { payApp } = await api.post(`/projects/${projectId}/billing/pay-apps`, {
        periodStart: form.periodStart || null,
        periodEnd: form.periodEnd || null,
        retentionPercent: retention,
      });
      onSaved(payApp);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New Pay Application</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Period Start</label>
              <input type="date" value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Period End</label>
              <input type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: "1.2rem" }}>
            <label style={labelStyle}>Retention (%)</label>
            <input value={form.retentionPercent} onChange={(e) => setForm((f) => ({ ...f, retentionPercent: e.target.value }))} style={inputStyle} placeholder="10" />
          </div>
          <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>
            This creates one line per current budget line, carrying forward completed amounts from the last approved or paid application.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Creating..." : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- lien waiver modal ----------
function LienWaiverModal({ projectId, payAppId, onClose, onSaved }) {
  const [form, setForm] = useState({ waiverType: "conditional_progress", vendorName: "", amount: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.vendorName.trim()) return setError("A vendor name is required.");
    const cents = parseDollarsToCents(form.amount || "0");
    if (Number.isNaN(cents)) return setError("Enter a valid amount.");
    setSaving(true);
    try {
      const { lienWaiver } = await api.post(`/projects/${projectId}/billing/pay-apps/${payAppId}/lien-waivers`, {
        waiverType: form.waiverType,
        vendorName: form.vendorName.trim(),
        amountCents: cents,
      });
      onSaved(lienWaiver);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New Lien Waiver</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Waiver Type</label>
            <select value={form.waiverType} onChange={(e) => setForm((f) => ({ ...f, waiverType: e.target.value }))} style={inputStyle}>
              <option value="conditional_progress">Conditional — Progress</option>
              <option value="unconditional_progress">Unconditional — Progress</option>
              <option value="conditional_final">Conditional — Final</option>
              <option value="unconditional_final">Unconditional — Final</option>
            </select>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>Vendor / Subcontractor</label>
            <input autoFocus value={form.vendorName} onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))} style={inputStyle} placeholder="e.g. ABC Electrical" />
          </div>
          <div style={{ marginBottom: "1.2rem" }}>
            <label style={labelStyle}>Amount ($)</label>
            <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={inputStyle} placeholder="0.00" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" disabled={saving}>{saving ? "Adding..." : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- pay app detail ----------
function PayAppDetail({ projectId, payAppId, canManage, isClient, onBack, onChanged }) {
  const [payApp, setPayApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingItems, setEditingItems] = useState({}); // id -> { thisPeriod, thisPeriodPercent, stored }
  const [thisPeriodMode, setThisPeriodMode] = useState("dollar"); // "dollar" | "percent"
  const [waiverModal, setWaiverModal] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const fileInputs = {};

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get(`/billing/pay-apps/${payAppId}`);
      setPayApp(d.payApp);
      const edits = {};
      for (const it of d.payApp.items) {
        const thisPeriod = centsToInput(it.thisPeriodCents);
        edits[it.id] = {
          thisPeriod,
          thisPeriodPercent: percentFromDollarInput(thisPeriod, it.scheduledValueCents),
          stored: centsToInput(it.materialsStoredCents),
        };
      }
      setEditingItems(edits);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [payAppId]);

  useEffect(() => { load(); }, [load]);

  async function saveItem(itemId) {
    const edit = editingItems[itemId];
    const thisPeriod = parseDollarsToCents(edit.thisPeriod || "0");
    const stored = parseDollarsToCents(edit.stored || "0");
    if (Number.isNaN(thisPeriod) || Number.isNaN(stored)) return alert("Enter valid dollar amounts.");
    setBusy(true);
    try {
      await api.patch(`/billing/pay-app-items/${itemId}`, { thisPeriodCents: thisPeriod, materialsStoredCents: stored });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function transition(action, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await api.post(`/billing/pay-apps/${payAppId}/transition`, { action });
      await load();
      onChanged && onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateWaiverStatus(waiver, status) {
    setBusy(true);
    try {
      await api.patch(`/billing/lien-waivers/${waiver.id}`, { status });
      await load();
    } catch (err) { alert(err.message); } finally { setBusy(false); }
  }

  async function removeWaiver(waiver) {
    if (!confirm(`Remove the lien waiver for ${waiver.vendorName}?`)) return;
    setBusy(true);
    try {
      await api.delete(`/billing/lien-waivers/${waiver.id}`);
      await load();
    } catch (err) { alert(err.message); } finally { setBusy(false); }
  }

  async function uploadWaiverFile(waiver, file) {
    setBusy(true);
    try {
      const ct = file.type || "application/octet-stream";
      const { uploadUrl, storageKey } = await api.post(
        `/projects/${projectId}/billing/lien-waivers/${waiver.id}/attachment/upload-url`,
        { fileName: file.name, contentType: ct }
      );
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
      if (!put.ok) throw new Error("Upload to storage failed.");
      await api.post(`/projects/${projectId}/billing/lien-waivers/${waiver.id}/attachment/confirm`, {
        storageKey, fileName: file.name, contentType: ct, sizeBytes: file.size,
      });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf() {
    setExportingPdf(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
      const token = localStorage.getItem("radah_pm_token");
      const res = await fetch(`${API_URL}/billing/pay-apps/${payAppId}/pdf`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const fileName = match ? match[1] : `Pay Application ${payApp.applicationNumber}.pdf`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      await load(); // pick up the new pdfDocumentId so "View Filed Copy" appears/updates
    } catch (err) {
      alert(err.message);
    } finally {
      setExportingPdf(false);
    }
  }

  async function downloadWaiverFile(waiver) {
    try {
      const { downloadUrl } = await api.get(`/documents/${waiver.documentId}/download-url`);
      window.open(downloadUrl, "_blank");
    } catch (err) { alert(err.message); }
  }

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!payApp) return null;

  const t = payApp.totals;
  const canDecide = payApp.status === "submitted" && (canManage || isClient);
  const isDraft = payApp.status === "draft";

  return (
    <div>
      <button className="btn btn-outline btn-sm" style={{ marginBottom: "1rem" }} onClick={onBack}>← Back to Pay Applications</button>

      <div className="flex-between" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.2rem" }}>Pay Application #{payApp.applicationNumber}</h2>
          <span className="text-sm text-steel">
            {payApp.periodStart ? new Date(payApp.periodStart).toLocaleDateString() : "?"} – {payApp.periodEnd ? new Date(payApp.periodEnd).toLocaleDateString() : "?"}
            {" · "}Retention {payApp.retentionPercent}%
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          {payApp.pdfDocumentId && (
            <button className="btn btn-outline btn-sm" onClick={async () => {
              try {
                const { downloadUrl } = await api.get(`/documents/${payApp.pdfDocumentId}/download-url`);
                window.open(downloadUrl, "_blank");
              } catch (err) { alert(err.message); }
            }}>View Filed Copy</button>
          )}
          <button className="btn btn-outline btn-sm" disabled={exportingPdf} onClick={exportPdf}>
            {exportingPdf ? "Exporting…" : "Export PDF"}
          </button>
          <span className={`badge ${STATUS_BADGE[payApp.status] || ""}`} style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>{payApp.status}</span>
        </div>
      </div>

      <p className="text-sm text-steel" style={{ marginTop: "-0.6rem", marginBottom: "1rem" }}>
        Exporting also files a copy under Documents → 06 - Cost &amp; Billing → Pay Applications, replacing any previously filed copy.
      </p>

      <div className="card" style={cardStyle}>
        <div style={statGrid}>
          <Stat label="Scheduled Value" value={fmtMoney(t.scheduledValueCents)} />
          <Stat label="Completed & Stored" value={fmtMoney(t.totalCompletedAndStoredCents)} />
          <Stat label="% Complete" value={`${t.percentComplete}%`} />
          <Stat label="Retention" value={fmtMoney(t.retentionCents)} />
          <Stat label="Balance to Finish" value={fmtMoney(t.balanceToFinishCents)} />
          <Stat label="Previous Payments" value={fmtMoney(t.previousPaymentsCents)} />
          <Stat label="Current Payment Due" value={fmtMoney(t.currentPaymentDueCents)} emphasize />
        </div>
      </div>

      {canManage && (
        <div className="flex-between" style={{ marginBottom: "0.8rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <span className="text-sm text-steel">{isDraft ? "Edit this period's billed and stored amounts below." : "This application is locked while not in Draft."}</span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {isDraft && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => transition("submit")}>Submit</button>}
            {payApp.status === "approved" && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => transition("revert", "Revert to Submitted? This does not undo payment.")}>Revert to Submitted</button>}
            {payApp.status === "approved" && <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => transition("mark-paid", `Mark Pay App #${payApp.applicationNumber} as paid?`)}>Mark Paid</button>}
          </div>
        </div>
      )}
      {canDecide && (
        <div className="flex-between" style={{ marginBottom: "0.8rem" }}>
          <span className="text-sm text-steel">This application is awaiting a decision.</span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => transition("approve")}>Approve</button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => transition("reject", `Reject Pay App #${payApp.applicationNumber}?`)}>Reject</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "1.2rem" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ textAlign: "right" }}>Scheduled Value</th>
              <th style={{ textAlign: "right" }}>Previous</th>
              <th style={{ textAlign: "right" }}>
                This Period
                {isDraft && canManage && (
                  <span style={{ display: "inline-flex", marginLeft: 6, border: "1px solid var(--line)", borderRadius: 4, overflow: "hidden", verticalAlign: "middle" }}>
                    <button
                      type="button"
                      onClick={() => setThisPeriodMode("dollar")}
                      title="Enter this period as a dollar amount"
                      style={{
                        padding: "1px 6px", fontSize: "0.68rem", border: "none", cursor: "pointer",
                        background: thisPeriodMode === "dollar" ? "var(--navy, #0B1F3A)" : "transparent",
                        color: thisPeriodMode === "dollar" ? "#fff" : "inherit",
                      }}
                    >$</button>
                    <button
                      type="button"
                      onClick={() => setThisPeriodMode("percent")}
                      title="Enter this period as a % of Scheduled Value"
                      style={{
                        padding: "1px 6px", fontSize: "0.68rem", border: "none", cursor: "pointer",
                        background: thisPeriodMode === "percent" ? "var(--navy, #0B1F3A)" : "transparent",
                        color: thisPeriodMode === "percent" ? "#fff" : "inherit",
                      }}
                    >%</button>
                  </span>
                )}
              </th>
              <th style={{ textAlign: "right" }}>Stored</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "right" }}>% Complete</th>
              {isDraft && canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {payApp.items.map((it) => {
              const edit = editingItems[it.id] || { thisPeriod: "0.00", thisPeriodPercent: "0.00", stored: "0.00" };
              return (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(it.scheduledValueCents)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(it.previousCompletedCents)}</td>
                  <td style={{ textAlign: "right" }}>
                    {isDraft && canManage ? (
                      thisPeriodMode === "percent" && it.scheduledValueCents > 0 ? (
                        <div>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <input
                              value={edit.thisPeriodPercent}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditingItems((p) => ({
                                  ...p,
                                  [it.id]: { ...p[it.id], thisPeriodPercent: v, thisPeriod: dollarInputFromPercent(v, it.scheduledValueCents) },
                                }));
                              }}
                              style={{ width: 60, textAlign: "right", border: "1px solid var(--line)", borderRadius: 4, padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}
                            />
                            <span className="text-sm text-steel">%</span>
                          </span>
                          <div className="text-sm text-steel" style={{ marginTop: 2 }}>
                            {fmtMoney(parseDollarsToCents(edit.thisPeriod || "0"))}
                          </div>
                        </div>
                      ) : (
                        <input
                          value={edit.thisPeriod}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEditingItems((p) => ({
                              ...p,
                              [it.id]: { ...p[it.id], thisPeriod: v, thisPeriodPercent: percentFromDollarInput(v, it.scheduledValueCents) },
                            }));
                          }}
                          style={{ width: 100, textAlign: "right", border: "1px solid var(--line)", borderRadius: 4, padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}
                        />
                      )
                    ) : fmtMoney(it.thisPeriodCents)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {isDraft && canManage ? (
                      <input
                        value={edit.stored}
                        onChange={(e) => setEditingItems((p) => ({ ...p, [it.id]: { ...p[it.id], stored: e.target.value } }))}
                        style={{ width: 100, textAlign: "right", border: "1px solid var(--line)", borderRadius: 4, padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}
                      />
                    ) : fmtMoney(it.materialsStoredCents)}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(it.totalCompletedAndStoredCents)}</td>
                  <td style={{ textAlign: "right" }}>{it.percentComplete}%</td>
                  {isDraft && canManage && (
                    <td><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => saveItem(it.id)}>Save</button></td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="flex-between" style={{ marginBottom: "0.8rem" }}>
          <h3 style={{ fontSize: "0.95rem", textTransform: "uppercase" }}>Lien Waivers</h3>
          {canManage && <button className="btn btn-outline btn-sm" onClick={() => setWaiverModal(true)}>+ Add Waiver</button>}
        </div>
        {payApp.lienWaivers.length === 0 ? (
          <p className="text-sm text-steel">No lien waivers on this application yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Vendor</th><th>Type</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th>Document</th><th></th></tr>
            </thead>
            <tbody>
              {payApp.lienWaivers.map((w) => (
                <tr key={w.id}>
                  <td>{w.vendorName}</td>
                  <td className="text-sm">{w.waiverType.replace(/_/g, " ")}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(w.amountCents)}</td>
                  <td>
                    {canManage ? (
                      <select value={w.status} onChange={(e) => updateWaiverStatus(w, e.target.value)} style={{ border: "1px solid var(--line)", borderRadius: 4, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}>
                        <option value="pending">pending</option>
                        <option value="received">received</option>
                      </select>
                    ) : (
                      <span className={`badge ${w.status === "received" ? "badge-active" : "badge-not_started"}`}>{w.status}</span>
                    )}
                  </td>
                  <td>
                    {w.documentId ? (
                      <button className="btn btn-outline btn-sm" onClick={() => downloadWaiverFile(w)}>{w.documentFileName || "View"}</button>
                    ) : canManage ? (
                      <>
                        <input ref={(el) => (fileInputs[w.id] = el)} type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadWaiverFile(w, f); }} />
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => fileInputs[w.id]?.click()}>Upload</button>
                      </>
                    ) : "—"}
                  </td>
                  <td>{canManage && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => removeWaiver(w)}>×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {waiverModal && (
        <LienWaiverModal
          projectId={projectId}
          payAppId={payAppId}
          onClose={() => setWaiverModal(false)}
          onSaved={() => { setWaiverModal(false); load(); }}
        />
      )}
    </div>
  );
}

// ---------- main tab ----------
export default function BillingTab({ projectId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get(`/projects/${projectId}/billing/pay-apps`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function remove(payApp) {
    if (!confirm(`Delete Pay App #${payApp.applicationNumber}?`)) return;
    setBusyId(payApp.id);
    try {
      await api.delete(`/billing/pay-apps/${payApp.id}`);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (openId) {
    return (
      <PayAppDetail
        projectId={projectId}
        payAppId={openId}
        canManage={data && data.canManage}
        isClient={user.role === "client"}
        onBack={() => { setOpenId(null); load(); }}
        onChanged={load}
      />
    );
  }

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const { canManage, payApps } = data;

  return (
    <div>
      {canManage && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span className="text-sm text-steel">A new pay application seeds one line per current budget line and carries forward billed-to-date amounts.</span>
          <button className="btn btn-gold" onClick={() => setModal(true)}>+ New Pay Application</button>
        </div>
      )}

      {payApps.length === 0 ? (
        <div className="card"><div className="empty-state">
          <h3>No pay applications yet</h3>
          <p className="text-sm">{canManage ? "Create the first one to start billing against the budget." : "There are no pay applications for this project yet."}</p>
        </div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>App #</th>
                <th>Period</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Completed &amp; Stored</th>
                <th style={{ textAlign: "right" }}>Retention</th>
                <th style={{ textAlign: "right" }}>Payment Due</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payApps.map((pa) => (
                <tr key={pa.id} className="clickable" onClick={() => setOpenId(pa.id)}>
                  <td><strong>#{pa.applicationNumber}</strong></td>
                  <td className="text-sm">
                    {pa.periodStart ? new Date(pa.periodStart).toLocaleDateString() : "?"} – {pa.periodEnd ? new Date(pa.periodEnd).toLocaleDateString() : "?"}
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[pa.status] || ""}`}>{pa.status}</span></td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(pa.totals.totalCompletedAndStoredCents)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(pa.totals.retentionCents)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(pa.totals.currentPaymentDueCents)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {canManage && pa.status === "draft" && (
                      <button className="btn btn-danger btn-sm" disabled={busyId === pa.id} onClick={() => remove(pa)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <NewPayAppModal
          projectId={projectId}
          onClose={() => setModal(false)}
          onSaved={(payApp) => { setModal(false); load(); setOpenId(payApp.id); }}
        />
      )}
    </div>
  );
}
