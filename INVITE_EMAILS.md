# Welcome / Invite Emails

## The gap this closes
Creating an organization or a user sent NO email. You had to hand over the URL
and a temporary password yourself. (Before this, the platform only ever sent two
emails: password reset, and "email this daily log".)

## What happens now
Creating an organization, or a user inside an organization, sends the person a
welcome email containing a **"Set your password" link** — no password is ever
emailed. They click it, choose their own password, and sign in.

- The link is a **single-use token valid for 7 days**. It reuses the same hashed,
  expiring token machinery as the forgot-password flow (nothing new to trust).
- If the link expires, they simply use **Forgot password?** on the sign-in page.
- The set-password page greets them by name ("Welcome — Set Your Password") when
  they arrive from an invite.

## Fallback, on purpose
The temporary password is still generated and shown to YOU on screen, and the UI
now tells you whether the email actually sent:
  ✓ "A welcome email with a set-password link was sent."   → password is a fallback
  ⚠ "No welcome email was sent (reason)."                  → share the password securely
Account creation never fails because email failed.

## New + changed files
New: backend/invites.js
Changed: backend/routes/platform.js  (org creation invites the new org admin)
         backend/routes/users.js     (user creation invites the new user)
         frontend/src/pages/PlatformAdminPage.jsx  (shows invite status)
         frontend/src/pages/UsersPage.jsx          (shows invite status)
         frontend/src/pages/ResetPasswordPage.jsx  (welcome copy for invites)

No migration (reuses password_reset_tokens). No new env vars.
Uses APP_URL (defaults to https://app.mangodoe.com) for the link, and the
existing RESEND_API_KEY / MAIL_FROM.

## Deploy
git add . && git commit -m "Welcome/invite emails with set-password links" && git push

## Test
1. Organizations → Create Organization with an email you control.
   → Banner says a welcome email was sent. Check the inbox.
2. Click "Set your password" → the page reads "Welcome — Set Your Password".
   Choose a password → you're redirected to sign in → log in with it.
3. Users → + Add User with another address you control → same flow, and the
   email says who invited them.
4. Click the same link twice → the second time it's rejected (single use).
