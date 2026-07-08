# Security Hardening

Closes the two exploitable gaps identified in the platform review, plus baseline
response headers. No new npm dependencies (nothing to install, one less
supply-chain surface).

## 1. Rate limiting  (was: none — login could be brute-forced indefinitely)
In-memory limiter, `backend/middleware/rateLimit.js`:
  • Login              10 attempts / 15 min, keyed by IP + email
                       (so an attacker can't lock out a real user from elsewhere;
                        a successful sign-in clears the counter)
  • Forgot password     5 requests / hour per IP
  • Reset password     10 attempts / 15 min per IP (stops token guessing)
  • Global /api        300 requests / min per IP (catch-all)
Returns HTTP 429 with Retry-After. `app.set("trust proxy", 1)` so the limiter
sees the real client IP behind Railway's proxy.

HONEST LIMITATION: counters live in this process's memory. They reset on
redeploy, and each instance would keep its own counters if you ever run more
than one. Correct for today's single-instance deployment; move to Redis if you
scale horizontally.

## 2. Session revocation  (was: a stolen JWT stayed valid for 7 days)
New `users.token_version` column, embedded in the JWT as `tv`. Every request
checks the token's version against the database (cached in-process for 15s, so
this is not a DB round trip per request). Bumping the version instantly signs a
user out everywhere. It now happens on:
  • change password  — other devices signed out; THIS session gets a fresh token
                       (so you aren't logged out mid-action)
  • reset password   — all sessions from before the reset die
  • admin reset password (own org)  — target user's sessions die
  • platform admin resets an org admin's password — same
  • DEACTIVATE A USER — previously their token kept working for up to 7 days.
                        Now access stops immediately.

Also: `requireAuth` now rejects tokens belonging to deleted or deactivated
accounts, which it never checked before.

Backwards compatible: tokens issued before this change have no `tv` and are
treated as version 0, so nobody is force-logged-out on deploy.

## 3. Security headers
`backend/middleware/securityHeaders.js`: nosniff, X-Frame-Options DENY,
Referrer-Policy no-referrer, Permissions-Policy, HSTS (1 year), a locked-down
CSP, and X-Powered-By removed. JSON body limit set to 1mb.

## New + changed files
New: backend/db/migrations_phase3_token_version.sql
     backend/middleware/rateLimit.js
     backend/middleware/securityHeaders.js
Changed: backend/db/migrate.js, backend/middleware/auth.js, backend/server.js,
         backend/routes/auth.js, backend/routes/users.js, backend/routes/platform.js,
         frontend/src/pages/SettingsPage.jsx

## Deploy
git add . && git commit -m "Security hardening: rate limiting, session revocation, headers" && git push
Log should show: Migration (session revocation) complete. No env vars.

## Test
1. Sign in with a wrong password 11 times → the 11th returns 429 "Too many
   sign-in attempts." Sign in correctly after the window and the counter clears.
2. Log in on two browsers. In browser A: Settings → Change Password.
   → Browser A stays signed in. Browser B is signed out on its next request.
3. Deactivate a user (Users page) while they're logged in → their next request
   is rejected immediately (previously it worked for days).
4. `curl -I https://api.mangodoe.com/api/health` → see nosniff, HSTS, no X-Powered-By.

## Still open (from the review, in priority order)
- Vercel Hobby → Pro before charging anyone (compliance, not code)
- Secrets into a password manager
- Automated pg_dump → R2, and TEST A RESTORE
- Error monitoring (Sentry), dependency scanning (Dependabot)
- Audit log, MFA — when a customer asks
