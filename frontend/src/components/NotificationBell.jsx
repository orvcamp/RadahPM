// src/components/NotificationBell.jsx
//
// In-app notification bell. Polls the unread count on a slow interval (no
// websockets — this is a construction app, not a chat app), and loads the
// list only when opened. Clicking a notification marks it read and navigates
// to the relevant project tab.

import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

const POLL_MS = 60_000;

function timeAgo(iso) {
  if (!iso) return "";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const TYPE_ICON = {
  "document.uploaded": "📄",
  "rfi.raised": "❓",
  "rfi.answered": "✅",
  "submittal.returned": "📐",
  "changeorder.submitted": "📝",
  "changeorder.approved": "✅",
  "changeorder.rejected": "⛔",
  "dailylog.filed": "🧱",
};

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  const pollCount = useCallback(async () => {
    try {
      const d = await api.get("/notifications/unread-count");
      setUnread(d.unreadCount || 0);
    } catch { /* silent — a failed poll must not disturb the app */ }
  }, []);

  useEffect(() => {
    pollCount();
    const t = setInterval(pollCount, POLL_MS);
    return () => clearInterval(t);
  }, [pollCount]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    try {
      const d = await api.get("/notifications?limit=20");
      setItems(d.notifications);
      setUnread(d.unreadCount || 0);
    } catch { /* leave the list as-is */ } finally {
      setLoading(false);
    }
  }

  async function openItem(n) {
    setOpen(false);
    if (!n.read) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      api.post(`/notifications/${n.id}/read`, {}).catch(() => {});
    }
    if (n.projectId) {
      navigate(`/projects/${n.projectId}${n.tab ? `?tab=${n.tab}` : ""}`);
    }
  }

  async function markAll() {
    try {
      await api.post("/notifications/read-all", {});
      setUnread(0);
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    } catch (err) { alert(err.message); }
  }

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        onClick={toggle}
        title="Notifications"
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        style={{
          position: "relative", background: "none", border: "1px solid var(--line)",
          borderRadius: 8, width: 38, height: 38, cursor: "pointer", fontSize: "1.05rem", lineHeight: 1,
        }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, padding: "0 4px",
              borderRadius: 9, background: "var(--red, #B23B3B)", color: "#fff",
              fontSize: "0.68rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", right: 0, top: 46, width: 360, maxHeight: 460, overflowY: "auto",
            background: "#fff", border: "1px solid var(--line)", borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)", zIndex: 50,
          }}
        >
          <div className="flex-between" style={{ padding: "0.7rem 0.9rem", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Notifications</strong>
            {unread > 0 && (
              <button className="btn btn-outline btn-sm" onClick={markAll}>Mark all read</button>
            )}
          </div>

          {loading ? (
            <div style={{ padding: "1.2rem" }}><div className="loading-spinner" /></div>
          ) : items.length === 0 ? (
            <div style={{ padding: "1.6rem 1rem", textAlign: "center" }}>
              <p className="text-sm text-steel">Nothing yet. Activity on your projects will show up here.</p>
            </div>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                onClick={() => openItem(n)}
                style={{
                  display: "flex", gap: "0.6rem", padding: "0.7rem 0.9rem", cursor: "pointer",
                  borderBottom: "1px solid var(--line)",
                  background: n.read ? "#fff" : "rgba(201,162,39,0.07)",
                }}
              >
                <div style={{ fontSize: "1.05rem", lineHeight: 1.2 }}>{TYPE_ICON[n.type] || "•"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: n.read ? 400 : 700 }}>{n.title}</div>
                  {n.body && <div className="text-sm text-steel" style={{ fontSize: "0.76rem" }}>{n.body}</div>}
                  <div className="text-steel" style={{ fontSize: "0.7rem", marginTop: 2 }}>
                    {n.projectName ? `${n.projectName} · ` : ""}{timeAgo(n.createdAt)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
