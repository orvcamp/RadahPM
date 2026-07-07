# RADAH PM — Email Foundation + Email Daily Log

## What's in this drop
**New:**
- `backend/mail.js` — Resend-backed mail module (uses fetch, no SDK dependency).
  Reads `RESEND_API_KEY` and `MAIL_FROM` from the environment; degrades gracefully
  (503/"not configured") if they're absent, like the R2 client.

**Changed:**
- `backend/routes/dailylogs.js` — new `POST /projects/:projectId/daily-logs/:logId/email`
  endpoint (org-scoped via the A2 `guardProject`), builds a formatted HTML email of the
  log and sends it. Includes short-lived links to any photos.
- `frontend/src/components/DailyLogsTab.jsx` — an **Email** button on every daily-log card,
  opening a modal whose recipient list is **pre-filled with the project team** and fully
  editable, plus an optional note. Replies go to the sender's address.

No migration, no schema change, no new frontend dependency. Uses the `RESEND_API_KEY`
and `MAIL_FROM` you already set in Railway.

## Deploy
1. Copy files in, then:
   ```
   git add .
   git commit -m "Email foundation + email daily log"
   git push
   ```
2. Railway redeploys (it already has RESEND_API_KEY + MAIL_FROM). Confirm Active.

## Test
1. Project → **Daily Logs** → on any log, click **Email**.
2. The recipient box is pre-filled with the project team's emails — for the first test,
   replace it with **your own email address** so you can confirm receipt.
3. Add an optional note → **Send Email**.
4. Check that inbox (and spam, just in case on the very first send from a new domain).

## Notes / expectations
- `MAIL_FROM` must be `@mangodoe.com` (the verified domain) — it is (`no-reply@mangodoe.com`).
- Because mangodoe.com is a verified custom domain in Resend, sending to outside recipients
  works (the "only send to yourself" limit only applies to Resend's shared test domain, not
  a verified domain). If a send is rejected, the error text from Resend is surfaced in the
  UI — paste it and we'll sort it.
- First emails from a brand-new domain occasionally land in spam until the domain builds a
  little reputation. The DMARC/SPF/DKIM you set up minimizes this.

## Where this leaves things
Email foundation is now in place — any future notification (change-order approvals, task
assignments, etc.) can reuse `mail.js`. Multi-tenancy (A1+A2) is complete, so email is
org-safe (recipients come from the org-scoped project team).

Still open / deferred: Stage B (org admin role, invite emails — now buildable on this mail
module), Tier 3 (RFIs & submittals), billing, and the product-domain/branding decision
(mangodoe.com is fine as the technical sending domain for now).
