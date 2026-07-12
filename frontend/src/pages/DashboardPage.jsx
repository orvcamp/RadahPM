// src/pages/DashboardPage.jsx

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function DashboardPage() {
  const { user } = useAuth();
  const isFacilities = user.orgVertical === "facilities";
  const noun = isFacilities ? "Properties" : "Projects";
  const nounSingular = isFacilities ? "Property" : "Project";
  const basePath = isFacilities ? "/properties" : "/projects";
  const endpoint = isFacilities ? "/properties" : "/projects";
  const listKey = isFacilities ? "properties" : "projects";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(endpoint)
      .then((data) => setItems(data[listKey]))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [endpoint, listKey]);

  const activeCount = items.filter((p) => p.status === "active").length;
  const planningCount = items.filter((p) => p.status === "planning").length;
  const onHoldCount = items.filter((p) => p.status === "on_hold").length;
  const completedCount = items.filter((p) => p.status === "completed").length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back, {user.fullName.split(" ")[0]}.</p>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {loading ? (
        <div className="loading-spinner" />
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-card">
              <span className="num">{items.length}</span>
              <span className="label">{user.role === "admin" || user.role === "staff" ? `Total ${noun}` : `Your ${noun}`}</span>
            </div>
            <div className="stat-card">
              <span className="num">{activeCount}</span>
              <span className="label">Active</span>
            </div>
            <div className="stat-card">
              <span className="num">{planningCount}</span>
              <span className="label">In Planning</span>
            </div>
            <div className="stat-card">
              <span className="num">{onHoldCount + completedCount}</span>
              <span className="label">On Hold / Completed</span>
            </div>
          </div>

          <div className="card">
            <div className="flex-between mt-1" style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "1rem", textTransform: "uppercase" }}>Recent {noun}</h3>
              <Link to={basePath} className="btn btn-outline btn-sm">View All</Link>
            </div>

            {items.length === 0 ? (
              <div className="empty-state">
                <h3>No {noun.toLowerCase()} yet</h3>
                <p className="text-sm">
                  {user.role === "admin" || user.role === "staff"
                    ? `Create your first ${nounSingular.toLowerCase()} to get started.`
                    : `You haven't been added to any ${noun.toLowerCase()} yet. Contact your administrator if you believe this is an error.`}
                </p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{nounSingular}</th>
                    <th>Status</th>
                    <th>{isFacilities ? "Address" : "Target Completion"}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 6).map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => (window.location.href = `${basePath}/${p.id}`)}>
                      <td>
                        <strong>{p.name}</strong>
                        {!isFacilities && p.clientOrgName && <div className="text-sm text-steel">{p.clientOrgName}</div>}
                      </td>
                      <td><span className={`badge badge-${p.status}`}>{p.status.replace("_", " ")}</span></td>
                      <td>{isFacilities ? (p.address || "—") : (p.targetEndDate ? new Date(p.targetEndDate).toLocaleDateString() : "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
