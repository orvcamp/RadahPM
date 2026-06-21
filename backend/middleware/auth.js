// backend/middleware/auth.js
// JWT verification + role-based access control helpers.

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn(
    "[radah-pm] WARNING: JWT_SECRET is not set. Set a long, random value " +
      "in your environment variables before deploying to production."
  );
}

/**
 * Verifies the Bearer token on the request and attaches the decoded
 * payload (id, email, role) to req.user. Responds 401 if missing/invalid.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, email, role, fullName }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
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

/** True if the user's platform role is admin or staff (full project visibility). */
function isInternal(user) {
  return user && (user.role === "admin" || user.role === "staff");
}

module.exports = { requireAuth, requireRole, isInternal, JWT_SECRET };
