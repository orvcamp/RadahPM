// src/pages/PropertyDetailPage.jsx
//
// MangoDoe Facilities — Property detail shell. A Property is a projects
// row under the hood (see backend Phase 6 notes), so Documents, Budget,
// and Reports are the exact same components ProjectDetailPage uses,
// unchanged — they only ever needed a projectId.

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import DocumentsTab from "../components/DocumentsTab.jsx";
import BudgetTab from "../components/BudgetTab.jsx";
import ReportsTab from "../components/ReportsTab.jsx";
import AssetsTab from "../components/AssetsTab.jsx";
import WorkOrdersTab from "../components/WorkOrdersTab.jsx";
import VendorContractsTab from "../components/VendorContractsTab.jsx";
import InspectionsTab from "../components/InspectionsTab.jsx";
import PropertyScheduleTab from "../components/PropertyScheduleTab.jsx";
import ChangeOrdersTab from "../components/ChangeOrdersTab.jsx";
import BillingTab from "../components/BillingTab.jsx";

const TABS = [
  { key: "overview", label: "Overview", module: null },
  { key: "schedule", label: "Schedule", module: null }, // shown if any of workorders/pm_scheduling/inspections is on — see visibleTabs filter below
  { key: "assets", label: "Assets", module: "assets" },
  { key: "workorders", label: "Work Orders", module: "workorders" },
  { key: "vendorcontracts", label: "Vendor Contracts", module: "vendors" },
  { key: "inspections", label: "Inspections", module: "inspections" },
  { key: "documents", label: "Documents", module: "documents" },
  { key: "budget", label: "Budget", module: "budget" },
  { key: "changeorders", label: "Capital Projects", module: "changeorders" },
  { key: "billing", label: "Billing", module: "billing" },
  { key: "reports", label: "Reports", module: "reports" },
];

const PROPERTY_TYPES = ["Office", "Retail", "Industrial", "Multifamily", "Healthcare", "Education", "Mixed Use", "Other"];
const STATUS_OPTIONS = ["planning", "active", "on_hold", "completed", "cancelled"];

function OverviewTab({ property, canEdit, onSaved }) {
  const [form, setForm] = useState({
    name: property.name, description: property.description || "", address: property.address || "",
    status: property.status, squareFootage: property.squareFootage || "", propertyType: property.propertyType || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const data = await api.patch(`/properties/${property.id}`, {
        ...form,
        squareFootage: form.squareFootage ? Number(form.squareFootage) : null,
      });
      onSaved(data.property);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="card">
        <h3 style={{ fontSize: "1rem", textTransform: "uppercase", marginBottom: "0.6rem" }}>{property.name}</h3>
        {property.description && <p className="text-sm text-steel" style={{ marginBottom: "0.8rem" }}>{property.description}</p>}
        <p className="text-sm">Address: {property.address || "—"}</p>
        <p className="text-sm">Type: {property.propertyType || "—"}</p>
        <p className="text-sm">Square Footage: {property.squareFootage ? property.squareFootage.toLocaleString() + " sf" : "—"}</p>
      </div>
    );
  }

  return (
    <div className="card">
      {error && <div className="error-msg">{error}</div>}
      <form onSubmit={save}>
        <div className="field"><label>Property Name</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div className="field"><label>Description</label><textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
        <div className="form-grid">
          <div className="field">
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Property Type</label>
            <select value={form.propertyType} onChange={(e) => setForm((f) => ({ ...f, propertyType: e.target.value }))}>
              <option value="">Select...</option>
              {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="form-grid">
          <div className="field"><label>Square Footage</label><input type="number" min="0" value={form.squareFootage} onChange={(e) => setForm((f) => ({ ...f, squareFootage: e.target.value }))} /></div>
          <div className="field"><label>Address</label><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
      </form>
    </div>
  );
}

export default function PropertyDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isInternal = user.role === "admin" || user.role === "staff";
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "overview");
  const [modules, setModules] = useState(null);

  useEffect(() => {
    api.get("/my-modules").then((d) => setModules(d.modules)).catch(() => setModules(null));
  }, []);
  // See the matching comment in ProjectDetailPage.jsx — same fail-closed fix.
  const modOn = (key) => !key || !modules || modules[key] === true;

  useEffect(() => {
    setLoading(true);
    api.get(`/properties/${id}`)
      .then((d) => setProperty(d.property))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loading-spinner" />;
  if (error) return <div className="error-msg">{error}</div>;
  if (!property) return null;

  const visibleTabs = TABS.filter((t) =>
    modOn(t.module)
    && !(t.key === "schedule" && !(modOn("workorders") || modOn("pm_scheduling") || modOn("inspections")))
    && !(t.module === "budget" && user.role === "trade_partner")
    && !(t.module === "changeorders" && user.role === "trade_partner")
    && !(t.module === "billing" && user.role === "trade_partner")
    && !(t.module === "reports" && user.role === "trade_partner")
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{property.name}</h1>
          <p>{property.address || "No address set"}</p>
        </div>
        <span className={`badge badge-${property.status}`}>{property.status.replace("_", " ")}</span>
      </div>

      <div className="tab-row">
        {visibleTabs.map((t) => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab property={property} canEdit={isInternal} onSaved={setProperty} />}
      {tab === "schedule" && <PropertyScheduleTab propertyId={id} onNavigate={setTab} />}
      {tab === "assets" && modOn("assets") && <AssetsTab propertyId={id} />}
      {tab === "workorders" && modOn("workorders") && <WorkOrdersTab propertyId={id} />}
      {tab === "vendorcontracts" && modOn("vendors") && <VendorContractsTab propertyId={id} />}
      {tab === "inspections" && modOn("inspections") && <InspectionsTab propertyId={id} />}
      {tab === "documents" && modOn("documents") && <DocumentsTab projectId={id} />}
      {tab === "budget" && user.role !== "trade_partner" && modOn("budget") && <BudgetTab projectId={id} />}
      {tab === "changeorders" && user.role !== "trade_partner" && modOn("changeorders") && <ChangeOrdersTab projectId={id} />}
      {tab === "billing" && user.role !== "trade_partner" && modOn("billing") && <BillingTab projectId={id} />}
      {tab === "reports" && user.role !== "trade_partner" && modOn("reports") && <ReportsTab projectId={id} />}
    </div>
  );
}
