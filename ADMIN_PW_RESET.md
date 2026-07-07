# Platform-Admin: Reset an Org's Admin Password

Adds a "Reset Admin PW" button per organization on the Organizations page
(platform admin only). It resets that org's admin password and shows a one-time
temporary password to share securely. Use it to recover access to King LLc.

Note: resetting a user WITHIN your own org already exists — the Users page has a
"Reset Password" button per user. This new action is the cross-org version, since
another org's admin never appears in your Users list.

## Files (both changed)
backend/routes/platform.js  (new endpoint POST /platform/organizations/:id/reset-admin)
frontend/src/pages/PlatformAdminPage.jsx  (button + modal)

## Deploy
git add . && git commit -m "Platform admin: reset an org's admin password" && git push
No migration, no env vars.

## Recover King LLc
Organizations page → King LLc row → "Reset Admin PW" → copy the temp password shown →
log in as King LLc's admin email with it (log out of your account first, or use a
private window). Change it after logging in.
