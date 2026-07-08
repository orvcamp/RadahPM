// backend/middleware/auth.js
// JWT verification + role-based access control helpers.
//
// Session revocation: a JWT alone is not enough. Each user row carries a
// token_version; the value is embedded in the token when it's issued. Bumping
// the user's token_version (on password change, password reset, or account
// deactivation) immediately invalidates every token they hold, rather than
// waiting up to 7 days for natural expiry.
//
// The user-state lookup is cached in-process briefly so this doesn't add a
// database round trip to every single request.

const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn(
    "[radah-pm] WARNING: JWT_SECRET is not set. Set a long, random value " +
      "in your environment variables before deploying to production."
  );
}

// ---- user-state cache (token_version + is_active) ----
const USER_CACHE_TTL_MS = 15000;
const userCache = new Map(); // id -> { tokenVersion, isActive, expiresAt }

function invalidateUserCache(userId) {
  userCache.delete(userId);
}

async function loadUserState(userId) {
  const now = Date.now();
  const hit = userCache.get(userId);
  if (hit && hit.expiresAt > now) return hit;

  const r = await pool.query("SELECT token_version, is_active FROM users WHERE id = $1", [userId]);
  if (r.rows.length === 0) {
    userCache.delete(userId);
    return null;
  }
  const state = {
    tokenVersion: r.rows[0].token_version == null ? 0 : r.rows[0].token_version,
    isActive: r.rows[0].is_active !== false,
    expiresAt: now + USER_CACHE_TTL_MS,
  };
  userCache.set(userId, state);
  return state;
}

/** Bump a user's token_version — logs them out of every device immediately. */
async function revokeUserSessions(userId, runner = pool) {
  await runner.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [userId]);
  invalidateUserCache(userId);
}

/**
 * Verifies the Bearer token, then confirms the account is still active and the
 * token hasn't been revoked. Attaches the decoded payload to req.user.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }

  try {
    const state = await loadUserState(payload.id);
    if (!state) {
      return res.status(401).json({ error: "Your account no longer exists." });
    }
    if (!state.isActive) {
      return res.status(403).json({ error: "This account has been deactivated." });
    }
    // Tokens issued before this feature have no `tv`; treat them as version 0
    // so existing sessions keep working until something revokes them.
    const tokenVersion = payload.tv == null ? 0 : payload.tv;
    if (tokenVersion !== state.tokenVersion) {
      return res.status(401).json({ error: "Your session has ended. Please log in again." });
    }
    req.user = payload; // { id, email, role, fullName, orgId, isPlatformAdmin, tv }
    next();
  } catch (err) {
    console.error("[radah-pm] auth state check failed:", err);
    return res.status(500).json({ error: "Something went wrong." });
  }
}

/**
 * Restricts a route to specific platform roles.
 * Usage: requireRole('admin', 'staff')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }
    next();
  };
}

/** True if the user's platform role is admin or staff (full visibility WITHIN their org). */
function isInternal(user) {
  return user && (user.role === "admin" || user.role === "staff");
}

/** True if the user is a platform (super) admin — the only role that may cross orgs. */
function isPlatformAdmin(user) {
  return !!(user && user.isPlatformAdmin);
}

/** Restricts a route to platform (super) admins. */
function requirePlatformAdmin(req, res, next) {
  if (!req.user || !req.user.isPlatformAdmin) {
    return res.status(403).json({ error: "Platform administrator access required." });
  }
  next();
}

/**
 * Ensures the authenticated user carries an organization context. Tokens
 * issued before multi-tenancy don't have orgId; those users must re-login.
 */
function requireOrg(req, res, next) {
  if (!req.user || !req.user.orgId) {
    return res.status(401).json({ error: "Your session predates a security update. Please log out and log in again." });
  }
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  isInternal,
  isPlatformAdmin,
  requireOrg,
  requirePlatformAdmin,
  revokeUserSessions,
  invalidateUserCache,
  JWT_SECRET,
};
