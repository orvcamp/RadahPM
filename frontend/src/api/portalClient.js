// src/api/portalClient.js
// Thin fetch wrapper for the Property Owner Portal, deliberately separate
// from api/client.js. portal_accounts is its own identity table on the
// backend (see Phase 10 migration notes) — a portal session and a staff
// session are unrelated tokens, so they get their own localStorage key
// here too. This lets a staff member testing the portal in the same
// browser (a different tab, say) keep both sessions alive at once without
// one logging the other out.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const TOKEN_KEY = "radah_portal_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setPortalToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}/portal${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const message = data.error || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  return data;
}

export const portalApi = {
  get: (path) => request(path),
  post: (path, body, opts = {}) => request(path, { method: "POST", body, ...opts }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};
