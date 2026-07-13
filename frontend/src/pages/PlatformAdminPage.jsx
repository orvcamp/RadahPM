// src/pages/PlatformAdminPage.jsx
//
// Platform (super) admin only: cross-vertical dashboard, org list with
// module-flag drill-down, provisioning, suspend/reactivate, admin password
// reset, and support impersonation. This is the Platform Console from
// Section 5 of the MangoDoe Enterprise design doc — a separate operator
// surface, not a customer role. It intentionally shows all three verticals
// at once; that's correct here specifically because the operator isn't a
// customer choosing one product for themselves.

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const VERTICALS = [
  { key: "construction", label: "Construction" },
  { key: "projects", label: "Projects" },
  { key: "facilities", label: "Facilities" },
];
const VERTICAL_LABEL = Object.fromEntries(VERTICALS.map((v) => [v.key, v.label]));

const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.55rem 0.8rem", fontSize: "0.88rem", marginBottom: "0.8rem" };

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <span className="num">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

export default function PlatformAdminPage() {
  const { user, impersonate } = useAuth();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [availableModules, setAvailableModules] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ orgName: "", adminEmail: "", adminFullName: "", vertical: "construction" });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [resetInfo, setResetInfo] = useState(null);
  const [busyOrgId, setBusyOrgId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get("/platform/organizations");
      setOrgs(d.organizations);
      setAvailableModules(d.availableModules || []);
      setSummary(d.summary || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resetAdmin(org) {
    if (!confirm(`Reset the admin password for "${org.name}"? This generates a new temporary password.`)) return;
    try {
      const d = await api.post(`/platform/organizations/${org.id}/reset-admin`, {});
      setResetInfo({ org, ...d });
    } catch (err) {
      alert(err.message);
    }
  }

  async function toggleModule(org, moduleKey, enabled) {
    // optimistic update
    setOrgs((prev) => prev.map((o) => o.id === org.id ? { ...o, modules: { ...o.modules, [moduleKey]: enabled } } : o));
    try {
      await api.patch(`/platform/organizations/${org.id}/modules`, { moduleKey, enabled });
    } catch (err) {
      alert(err.message);
      load(); // revert on failure
    }
  }

  async function toggleActive(org) {
    const goingInactive = org.isActive;
    if (goingInactive && !confirm(`Suspend "${org.name}"? This immediately signs out every user in that organization, and blocks new sign-ins until reactivated.`)) return;
    setBusyOrgId(org.id);
    try {
      const d = await api.patch(`/platform/organizations/${org.id}/status`, { isActive: !org.isActive });
      setOrgs((prev) => prev.map((o) => (o.id === org.id ? { ...o, isActive: d.isActive } : o)));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyOrgId(null);
    }
  }

  async function logInAs(org) {
    if (!confirm(`Log in as ${org.name}'s admin? You'll see exactly what they see. Use "Return to Platform Admin" in the banner to come back.`)) return;
    setBusyOrgId(org.id);
    try {
      const d = await api.post(`/platform/organizations/${org.id}/impersonate`, {});
      impersonate({ token: d.token, user: d.user, orgName: d.orgName });
      navigate("/");
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyOrgId(null);
    }
  }

  async function createOrg(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    setSubmitting(true);
    try {
      const d = await api.post("/platform/organizations", form);
      setResult(d);
      setForm({ orgName: "", adminEmail: "", adminFullName: "", vertical: "construction" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!user.isPlatformAdmin) {
    return <div className="error-msg">Platform administrator access required.</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>Platform Console</h1>
      <p className="text-steel" style={{ marginBottom: "1.5rem" }}>Cross-vertical view — every organization across Construction, Projects, and Facilities.</p>

      {summary && (
        <div className="stat-row" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          <StatCard label="Total Orgs" value={summary.totalOrgs} />
          <StatCard label="Active" value={summary.activeOrgs} />
          <StatCard label="Suspended" value={summary.suspendedOrgs} />
          <StatCard label="Construction" value={summary.verticalCounts.construction || 0} />
          <StatCard label="Facilities" value={summary.verticalCounts.facilities || 0} />
        </div>
      )}
      {summary && summary.verticalCounts.projects > 0 && (
        <p className="text-sm text-steel" style={{ marginTop: "-1rem", marginBottom: "1.5rem" }}>+ {summary.verticalCounts.projects} on Projects</p>
      )}
      <p className="text-sm text-steel" style={{ marginTop: summary ? 0 : undefined, marginBottom: "1.5rem" }}>
        MRR and pilot-decision tracking aren't shown here — that data isn't tracked anywhere in the schema yet. Org counts above are real, computed from actual rows.
      </p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase", marginBottom: "1rem" }}>Create Organization</h3>
        {error && <div className="error-msg">{error}</div>}
        {result && (
          <div className="success-msg" style={{ marginBottom: "1rem" }}>
            Created <strong>{result.organization.name}</strong> ({VERTICAL_LABEL[result.organization.vertical] || result.organization.vertical}) with admin <strong>{result.admin.email}</strong>.
            <div style={{ marginTop: "0.4rem" }}>
              {result.inviteEmailSent
                ? "✓ A welcome email with a set-password link was sent to them."
                : `⚠ No welcome email was sent${result.inviteEmailError ? ` (${result.inviteEmailError})` : ""}.`}
            </div>
            <div style={{ marginTop: "0.6rem" }}>
              {result.inviteEmailSent
                ? "Fallback temporary password (only needed if the email doesn't arrive):"
                : "Temporary password (share securely — they change it after first login):"}
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "1.05rem", background: "var(--paper, #f7f6f2)", padding: "0.55rem 0.9rem", borderRadius: 6, border: "1px solid var(--line)", wordBreak: "break-all", marginTop: "0.4rem", display: "inline-block" }}>
              {result.temporaryPassword}
            </div>
          </div>
        )}
        <form onSubmit={createOrg}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="text-sm text-steel">Organization name</label>
              <input value={form.orgName} onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))} style={inputStyle} placeholder="e.g. Acme Builders" />
            </div>
            <div>
              <label className="text-sm text-steel">Vertical</label>
              <select value={form.vertical} onChange={(e) => setForm((f) => ({ ...f, vertical: e.target.value }))} style={inputStyle}>
                {VERTICALS.map((v) => (
                  <option key={v.key} value={v.key} disabled={v.disabled}>
                    {v.label}{v.disabled ? " (not yet available)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-steel">Admin full name</label>
              <input value={form.adminFullName} onChange={(e) => setForm((f) => ({ ...f, adminFullName: e.target.value }))} style={inputStyle} placeholder="Jane Doe" />
            </div>
            <div>
              <label className="text-sm text-steel">Admin email</label>
              <input type="email" value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))} style={inputStyle} placeholder="jane@acme.com" />
            </div>
          </div>
          <p className="text-sm text-steel" style={{ margin: "0 0 0.9rem" }}>A temporary password is generated automatically and shown here after you create the organization. The vertical determines which product this org sees — it can't be changed later without a manual migration.</p>
          <button className="btn btn-gold" disabled={submitting}>{submitting ? "Creating…" : "Create Organization"}</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "1.5rem" }}><div className="loading-spinner" /></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Organization</th><th>Vertical</th><th>Status</th><th>Users</th><th>Projects</th><th>Modules</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} style={!o.isActive ? { opacity: 0.6 } : undefined}>
                  <td><strong>{o.name}</strong></td>
                  <td><span className="role-badge">{VERTICAL_LABEL[o.vertical] || o.vertical}</span></td>
                  <td><span className={`badge badge-${o.isActive ? "active" : "cancelled"}`}>{o.isActive ? "active" : "suspended"}</span></td>
                  <td>{o.userCount}</td>
                  <td>{o.projectCount}</td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {availableModules.filter((m) => !m.verticals || m.verticals.includes(o.vertical)).map((m) => {
                        const on = o.modules ? o.modules[m.key] !== false : true;
                        return (
                          <button
                            key={m.key}
                            onClick={() => toggleModule(o, m.key, !on)}
                            title={on ? "Enabled — click to disable" : "Disabled — click to enable"}
                            style={{
                              fontSize: "0.72rem",
                              padding: "0.2rem 0.5rem",
                              borderRadius: 999,
                              border: "1px solid var(--line)",
                              cursor: "pointer",
                              background: on ? "rgba(46,158,91,0.12)" : "rgba(0,0,0,0.04)",
                              color: on ? "var(--green-deep, #2E9E5B)" : "var(--steel)",
                            }}
                          >
                            {on ? "✓ " : "✕ "}{m.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button className="btn btn-outline btn-sm" disabled={busyOrgId === o.id || !o.isActive} onClick={() => logInAs(o)}>Log In As</button>
                      <button className="btn btn-outline btn-sm" onClick={() => resetAdmin(o)}>Reset Admin PW</button>
                      <button
                        className={`btn btn-sm ${o.isActive ? "btn-danger" : "btn-outline"}`}
                        disabled={busyOrgId === o.id}
                        onClick={() => toggleActive(o)}
                      >
                        {o.isActive ? "Suspend" : "Reactivate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {resetInfo && (
        <div className="modal-backdrop" onClick={() => setResetInfo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>Admin Password Reset</h3>
              <button className="modal-close" onClick={() => setResetInfo(null)}>×</button>
            </div>
            <p className="text-sm" style={{ marginBottom: "0.6rem" }}>
              New temporary password for <strong>{resetInfo.fullName || resetInfo.email}</strong> ({resetInfo.email}) at <strong>{resetInfo.org.name}</strong>:
            </p>
            <div style={{ fontFamily: "monospace", fontSize: "1.05rem", background: "var(--paper, #f7f6f2)", padding: "0.7rem 1rem", borderRadius: 6, border: "1px solid var(--line)", wordBreak: "break-all", marginBottom: "0.8rem" }}>
              {resetInfo.temporaryPassword}
            </div>
            <p className="text-sm text-steel" style={{ marginBottom: "1rem" }}>{resetInfo.note}</p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-gold" onClick={() => setResetInfo(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
