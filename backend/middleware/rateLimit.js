// backend/middleware/rateLimit.js
//
// Lightweight in-memory rate limiting. No external dependency (one less
// supply-chain surface, nothing to install).
//
// SCOPE / HONEST LIMITATION: counters live in this process's memory. They
// reset on redeploy, and if you ever run more than one backend instance each
// instance keeps its own counters. That's fine for the current single-instance
// deployment. If you scale horizontally, move this to Redis.
//
// Two layers are provided:
//   - a generous global limiter, to blunt scraping / accidental loops
//   - strict limiters on auth endpoints, which is where brute force happens

const buckets = new Map(); // key -> { count, resetAt }

// Periodically drop expired buckets so memory can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, 60_000).unref();

function clientKey(req) {
  // Railway sits behind a proxy; server.js sets `trust proxy` so req.ip is the
  // real client address rather than the proxy's.
  return req.ip || req.connection?.remoteAddress || "unknown";
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs      window length
 * @param {number} opts.max           max requests per key per window
 * @param {string} opts.message       response message on limit
 * @param {(req) => string} [opts.keyFn]  custom key (defaults to client IP)
 */
function rateLimit({ windowMs, max, message, keyFn }) {
  return (req, res, next) => {
    const key = `${req.baseUrl || ""}${req.path}|${(keyFn || clientKey)(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;

    const remaining = Math.max(0, max - b.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: message || "Too many requests. Please wait and try again.",
        retryAfterSeconds: retryAfter,
      });
    }
    next();
  };
}

// Clear a key's counter (e.g. after a successful login, so a legitimate user
// who fat-fingered their password a few times isn't punished afterwards).
function resetKey(req) {
  const key = `${req.baseUrl || ""}${req.path}|${clientKey(req)}`;
  buckets.delete(key);
}

// ---- Preconfigured limiters ----

// Brute-force protection. Keyed by IP + the email being tried, so one attacker
// can't lock out a real user by guessing against their address from elsewhere.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many sign-in attempts. Please wait 15 minutes and try again.",
  keyFn: (req) => `${clientKey(req)}|${String((req.body && req.body.email) || "").toLowerCase().trim()}`,
});

// Password reset requests: cheap to send, expensive to abuse (email + spam).
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests. Please wait an hour and try again.",
});

// Consuming a reset token — stop token guessing.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many attempts. Please request a new reset link.",
});

// Generous catch-all so a runaway client or scraper can't hammer the API.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: "Too many requests. Please slow down.",
});

module.exports = {
  rateLimit,
  resetKey,
  loginLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  globalLimiter,
};
