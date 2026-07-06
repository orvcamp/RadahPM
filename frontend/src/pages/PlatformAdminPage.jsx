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
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
              <tr><th>Organization</th><th>Users</th><th>Projects</th><th>Created</th></tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong></td>
                  <td>{o.userCount}</td>
                  <td>{o.projectCount}</td>
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
