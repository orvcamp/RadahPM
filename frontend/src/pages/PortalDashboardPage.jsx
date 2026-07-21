// src/pages/PortalDashboardPage.jsx
// Entry point after login. Most owners will have exactly one property —
// this skips straight to it rather than making them click through a list
// of one. Commercial owners with several properties (the multi-org case
// this whole identity layer was built for) see a picker instead.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi } from "../api/portalClient";

export default function PortalDashboardPage() {
  const navigate = useNavigate();
  const [properties, setProperties] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    portalApi
      .get("/properties")
      .then((data) => {
        setProperties(data.properties);
        if (data.properties.length === 1) {
          navigate(`/portal/properties/${data.properties[0].id}`, { replace: true });
        }
      })
      .catch((err) => setError(err.message || "Couldn't load your properties."));
  }, [navigate]);

  if (error) return <div className="error-msg">{error}</div>;
  if (properties === null) {
    return (
      <div className="center-page">
        <div className="loading-spinner" />
      </div>
    );
  }
  if (properties.length === 0) {
    return (
      <div className="empty-state">
        <h3>No properties yet</h3>
        <p>Your property manager hasn't granted access to any properties on this account.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Your Properties</h1>
        <p>Select a property to view documents, service history, and warranty status.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
        {properties.map((p) => (
          <div key={p.id} className="card" style={{ cursor: "pointer" }} onClick={() => navigate(`/portal/properties/${p.id}`)}>
            <h3 style={{ marginBottom: "0.3rem" }}>{p.name}</h3>
            {p.location && <p className="text-steel text-sm">{p.location}</p>}
            <p className="text-steel text-sm mt-1">{p.orgName}</p>
            {p.propertyType && <span className="badge badge-active mt-1">{p.propertyType}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
