// src/pages/PlatformAdminPage.jsx
//
// Platform (super) admin only: list organizations and provision a new one
// with its first admin. This is the seam that makes the platform multi-tenant
// and lets you test cross-org isolation by creating a second org to log into.

import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function PlatformAdminPage() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [availableModules, setAvailableModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ orgName: "", adminEmail: "", adminFullName: "", adminPassword: "" });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get("/platform/organizations");
      setOrgs(d.organizations);
      setAvailableModules(d.availableModules || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  async function createOrg(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    setSubmitting(true);
    try {
      const d = await api.post("/platform/organizations", form);
      setResult(d);
      setForm({ orgName: "", adminEmail: "", adminFullName: "", adminPassword: "" });
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

  const inputStyle = { width: "100%", border: "1.5px solid var(--line)", borderRadius: 6, padding: "0.55rem 0.8rem", fontSize: "0.88rem", marginBottom: "0.8rem" };

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>Organizations</h1>
      <p className="text-steel" style={{ marginBottom: "1.5rem" }}>Provision and review tenant organizations on the platform.</p>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase", marginBottom: "1rem" }}>Create Organization</h3>
        {error && <div className="error-msg">{error}</div>}
        {result && (
          <div className="success-msg" style={{ marginBottom: "1rem" }}>
            Created <strong>{result.organization.name}</strong> with admin <strong>{result.admin.email}</strong>.
            Share the password you set with them securely.
          </div>
        )}
        <form onSubmit={createOrg}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <div>
              <label className="text-sm text-steel">Organization name</label>
              <input value={form.orgName} onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))} style={inputStyle} placeholder="e.g. Acme Builders" />
            </div>
            <div>
              <label className="text-sm text-steel">Admin full name</label>
              <input value={form.adminFullName} onChange={(e) => setForm((f) => ({ ...f, adminFullName: e.target.value }))} style={inputStyle} placeholder="Jane Doe" />
            </div>
            <div>
              <label className="text-sm text-steel">Admin email</label>
              <input type="email" value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))} style={inputStyle} placeholder="jane@acme.com" />
            </div>
            <div>
              <label className="text-sm text-steel">Admin temporary password</label>
              <input value={form.adminPassword} onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))} style={inputStyle} placeholder="At least 8 characters" />
            </div>
          </div>
          <button className="btn btn-gold" disabled={submitting}>{submitting ? "Creating…" : "Create Organization"}</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "1.5rem" }}><div className="loading-spinner" /></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Organization</th><th>Users</th><th>Projects</th><th>Modules</th><th>Created</th></tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong></td>
                  <td>{o.userCount}</td>
                  <td>{o.projectCount}</td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {availableModules.map((m) => {
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
