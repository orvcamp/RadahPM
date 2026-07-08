// backend/middleware/securityHeaders.js
//
// Baseline security response headers. Written by hand rather than pulling in
// helmet — this is a JSON API, so only a handful of headers actually matter,
// and it keeps the dependency list small.

function securityHeaders(req, res, next) {
  // Don't advertise the framework.
  res.removeHeader("X-Powered-By");

  // Never let a browser sniff a JSON response into something executable.
  res.setHeader("X-Content-Type-Options", "nosniff");

  // This API is never meant to be framed.
  res.setHeader("X-Frame-Options", "DENY");

  // Don't leak the full URL (which can contain ids) to third parties.
  res.setHeader("Referrer-Policy", "no-referrer");

  // Turn off browser features this API has no use for.
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  // Force HTTPS for a year. Safe here: the API is served over TLS only.
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // A JSON API doesn't render HTML; lock the CSP down hard.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");

  next();
}

module.exports = securityHeaders;
