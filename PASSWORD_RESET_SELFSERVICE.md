# Self-Service Password Reset ("Forgot password?")

Adds an email-based reset flow. Secure by design: single-use, 1-hour tokens,
only a HASH of the token is stored, and the "enter your email" step never
reveals whether an account exists (no enumeration).

Note: "change my password while logged in" already existed (Settings page →
Change Password, backed by /auth/change-password). This drop adds the
forgot-password flow only.

## Flow
Login page → "Forgot password?" → enter email → email arrives with a link to
https://app.mangodoe.com/reset-password?token=... → set new password → sign in.

## New + changed files
New: backend/db/migrations_phase3_password_reset.sql,
     frontend/src/pages/ForgotPasswordPage.jsx,
     frontend/src/pages/ResetPasswordPage.jsx
Changed: backend/routes/auth.js (forgot/reset endpoints),
         backend/db/migrate.js (migration),
         frontend/src/pages/LoginPage.jsx ("Forgot password?" link),
         frontend/src/App.jsx (public /forgot-password and /reset-password routes)

## Env var (optional)
The reset link base URL defaults to https://app.mangodoe.com. To override,
set APP_URL in Railway (e.g. if you ever move domains). No action needed now.

## Deploy
git add . && git commit -m "Self-service password reset" && git push
Log should show: Migration (password reset) complete. Uses existing RESEND_API_KEY/MAIL_FROM.

## Test
1. Log out. On the login page click "Forgot password?".
2. Enter your own email → you get the generic "if an account exists…" message.
3. Check your inbox for the reset email → click "Set a new password".
4. Set a new password → you're redirected to sign in → log in with the new one.
Tip: request a link, then request another — the first should no longer work
(only the newest token is valid). Links also expire after 1 hour.
