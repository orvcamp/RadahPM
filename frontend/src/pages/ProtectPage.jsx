// src/pages/ProtectPage.jsx
//
// MangoDoe Facilities — Radah Protect™ membership program. Top-level page
// (not nested under a property), same reasoning as VendorsPage.jsx: Tiers
// are an org-wide catalog, and a Membership can be scoped to either a
// single property or the whole account — a single property's detail page
// isn't the right home for something that spans properties by design.
//
// Two tabs: Tiers (the org's discount catalog) and Memberships (who
// actually has one, property- or account-scoped).

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

// ============================================================
// TIERS TAB
// ============================================================

function TierModal({ tier, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: tier?.name || "",
    description: tier?.description || "",
    discountPercent: tier ? String(tier.discountPercent) : "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Tier name is required.");
    const pct = Number(form.discountPercent);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return setError("Discount must be a number between 0 and 100.");
    setSaving(true);
    try {
      const data = tier
        ? await api.patch(`/protect/tiers/${tier.id}`, { name: form.name, description: form.description, discountPercent: pct })
        : await api.post("/protect/tiers", { name: form.name, description: form.description, discountPercent: pct });
      onSaved(data.tier);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>{tier ? "Edit Tier" : "New Protect Tier"}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Tier Name *</label>
            <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Protect Gold" />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="field">
            <label>Discount (%) *</label>
            <input
              required
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.discountPercent}
              onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))}
              placeholder="15"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Saving..." : tier ? "Save Changes" : "Create Tier"}
          </button>
        </form>
      </div>
    </div>
  );
}

function TiersTab({ canManage }) {
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // tier being edited, or true for "new"

  function load() {
    api.get("/protect/tiers").then((d) => setTiers(d.tiers)).catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(tier) {
    try {
      const data = await api.patch(`/protect/tiers/${tier.id}`, { isActive: !tier.isActive });
      setTiers((prev) => prev.map((t) => (t.id === tier.id ? data.tier : t)));
    } catch (err) {
      alert(err.message);
    }
  }

  async function removeTier(tier) {
    if (!confirm(`Remove the "${tier.name}" tier? Existing memberships on it keep their discount, but it won't be assignable anymore.`)) return;
    try {
      await api.delete(`/protect/tiers/${tier.id}`);
      setTiers((prev) => prev.filter((t) => t.id !== tier.id));
    } catch (err) {
      alert(err.message);
    }
  }

  if (error) return <div className="error-msg">{error}</div>;
  if (tiers === null) return <div className="loading-spinner" />;

  return (
    <div>
      {canManage && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span />
          <button className="btn btn-gold" onClick={() => setEditing(true)}>+ New Tier</button>
        </div>
      )}

      {tiers.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <h3>No Protect tiers yet</h3>
            <p className="text-sm">Set up a tier (e.g. "Protect Gold" at 15% off) before assigning memberships.</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Description</th>
                <th>Discount</th>
                <th>Status</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td>{t.description || "—"}</td>
                  <td>{t.discountPercent}%</td>
                  <td>
                    <span className={`badge ${t.isActive ? "badge-active" : "badge-cancelled"}`}>{t.isActive ? "active" : "inactive"}</span>
                  </td>
                  {canManage && (
                    <td style={{ display: "flex", gap: "0.4rem" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => setEditing(t)}>Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => toggleActive(t)}>{t.isActive ? "Deactivate" : "Activate"}</button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeTier(t)}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TierModal
          tier={editing === true ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(tier) => {
            setEditing(null);
            setTiers((prev) => {
              const exists = prev.some((t) => t.id === tier.id);
              return exists ? prev.map((t) => (t.id === tier.id ? tier : t)) : [tier, ...prev];
            });
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// MEMBERSHIPS TAB
// ============================================================

function MembershipModal({ tiers, properties, orgName, orgId, onClose, onCreated }) {
  const [form, setForm] = useState({ scopeType: "property", propertyId: "", tierId: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (form.scopeType === "property" && !form.propertyId) return setError("Choose a property.");
    setSaving(true);
    try {
      const data = await api.post("/protect/memberships", {
        scopeType: form.scopeType,
        // Backend requires scopeId in both cases — for 'account' scope it
        // must equal the caller's own orgId (enforced server-side too).
        scopeId: form.scopeType === "property" ? form.propertyId : orgId,
        tierId: form.tierId || null,
      });
      onCreated(data.membership);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: "1.1rem", textTransform: "uppercase" }}>New Protect Membership</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Scope *</label>
            <select value={form.scopeType} onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value }))}>
              <option value="property">A single property</option>
              <option value="account">Whole account (volume — every property under {orgName})</option>
            </select>
          </div>
          {form.scopeType === "property" && (
            <div className="field">
              <label>Property *</label>
              <select required value={form.propertyId} onChange={(e) => setForm((f) => ({ ...f, propertyId: e.target.value }))}>
                <option value="">Select a property...</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>Tier</label>
            <select value={form.tierId} onChange={(e) => setForm((f) => ({ ...f, tierId: e.target.value }))}>
              <option value="">No tier (0% discount)</option>
              {tiers.filter((t) => t.isActive).map((t) => (
                <option key={t.id} value={t.id}>{t.name} — {t.discountPercent}%</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving}>
            {saving ? "Creating..." : "Create Membership"}
          </button>
        </form>
      </div>
    </div>
  );
}

function MembershipsTab({ canManage }) {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  function load() {
    Promise.all([api.get("/protect/memberships"), api.get("/protect/tiers"), api.get("/properties")])
      .then(([m, t, p]) => {
        setMemberships(m.memberships);
        setTiers(t.tiers);
        setProperties(p.properties);
      })
      .catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, []);

  function propertyName(id) {
    const p = properties.find((p) => p.id === id);
    return p ? p.name : "(property removed)";
  }

  async function updateStatus(m, status) {
    try {
      const data = await api.patch(`/protect/memberships/${m.id}`, { status });
      setMemberships((prev) => prev.map((x) => (x.id === m.id ? data.membership : x)));
    } catch (err) {
      alert(err.message);
    }
  }

  async function removeMembership(m) {
    if (!confirm("Remove this membership? The discount will no longer apply.")) return;
    try {
      await api.delete(`/protect/memberships/${m.id}`);
      setMemberships((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err) {
      alert(err.message);
    }
  }

  if (error) return <div className="error-msg">{error}</div>;
  if (memberships === null) return <div className="loading-spinner" />;

  return (
    <div>
      {canManage && (
        <div className="flex-between" style={{ marginBottom: "1rem" }}>
          <span />
          <button className="btn btn-gold" onClick={() => setShowNew(true)}>+ New Membership</button>
        </div>
      )}

      {memberships.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <h3>No Protect memberships yet</h3>
            <p className="text-sm">Assign a property (or the whole account) to a tier to start applying the discount.</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Tier</th>
                <th>Discount</th>
                <th>Billing</th>
                <th>Status</th>
                <th>Since</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.scopeType === "account" ? (
                      <span className="badge badge-active">Whole Account</span>
                    ) : (
                      propertyName(m.scopeId)
                    )}
                  </td>
                  <td>{m.tierName || "—"}</td>
                  <td>{m.discountPercent != null ? `${m.discountPercent}%` : "—"}</td>
                  <td style={{ textTransform: "capitalize" }}>{m.billingModel}</td>
                  <td>
                    <span className={`badge ${m.status === "active" ? "badge-active" : m.status === "paused" ? "badge-on_hold" : "badge-cancelled"}`}>
                      {m.status}
                    </span>
                  </td>
                  <td>{fmtDate(m.startDate)}</td>
                  {canManage && (
                    <td style={{ display: "flex", gap: "0.4rem" }}>
                      {m.status === "active" ? (
                        <button className="btn btn-outline btn-sm" onClick={() => updateStatus(m, "paused")}>Pause</button>
                      ) : (
                        <button className="btn btn-outline btn-sm" onClick={() => updateStatus(m, "active")}>Activate</button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => removeMembership(m)}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <MembershipModal
          tiers={tiers}
          properties={properties}
          orgName={user.orgName || "your organization"}
          orgId={user.orgId}
          onClose={() => setShowNew(false)}
          onCreated={(m) => {
            setShowNew(false);
            setMemberships((prev) => [m, ...prev]);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// PAGE SHELL
// ============================================================

export default function ProtectPage() {
  const { user } = useAuth();
  const canManage = user.role === "admin" || user.role === "staff";
  const [tab, setTab] = useState("memberships");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Radah Protect</h1>
          <p>Preventive-maintenance membership tiers and who's enrolled.</p>
        </div>
      </div>

      <div className="tab-row">
        <button className={`tab-btn ${tab === "memberships" ? "active" : ""}`} onClick={() => setTab("memberships")}>Memberships</button>
        <button className={`tab-btn ${tab === "tiers" ? "active" : ""}`} onClick={() => setTab("tiers")}>Tiers</button>
      </div>

      {tab === "memberships" && <MembershipsTab canManage={canManage} />}
      {tab === "tiers" && <TiersTab canManage={canManage} />}
    </div>
  );
}
