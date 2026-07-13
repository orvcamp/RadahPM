// src/components/ImpersonationBanner.jsx
//
// Shown whenever the active session is an impersonated one (see
// AuthContext's impersonate/stopImpersonating). Persistent and impossible
// to miss — a platform admin should never lose track of the fact that
// they're looking at a live tenant's account.

import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function ImpersonationBanner() {
  const { impersonatingOrgName, stopImpersonating } = useAuth();
  const navigate = useNavigate();

  if (!impersonatingOrgName) return null;

  return (
    <div
      style={{
        background: "#B23B3B",
        color: "#fff",
        padding: "0.5rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.8rem",
        fontSize: "0.85rem",
        fontWeight: 600,
        position: "sticky",
        top: 0,
        zIndex: 1000,
      }}
    >
      <span>Viewing as {impersonatingOrgName} — this is a live tenant's account.</span>
      <button
        onClick={() => {
          stopImpersonating();
          navigate("/platform");
        }}
        style={{
          background: "#fff",
          color: "#B23B3B",
          border: "none",
          borderRadius: 4,
          padding: "0.25rem 0.7rem",
          fontSize: "0.78rem",
          fontWeight: 700,
          cursor: "pointer",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        Return to Platform Admin
      </button>
    </div>
  );
}
