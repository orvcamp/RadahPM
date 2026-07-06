# RADAH PM — Phase 2 (Tier 2): Change Orders (deploy note)

## What's in this drop (new + changed only)
**New:**
- `backend/db/migrations_phase2_changeorders.sql` — change_orders table (additive, re-runnable)
- `backend/routes/changeorders.js` — CO API + workflow engine + budget integration
- `frontend/src/components/ChangeOrdersTab.jsx` — the Change Orders tab UI

**Changed:**
- `backend/db/migrate.js` — runs the change-orders migration
- `backend/server.js` — mounts the change-orders routes
- `frontend/src/pages/ProjectDetailPage.jsx` — adds the Change Orders tab (hidden for trade partners)

## What it does
Workflow: **Draft → Submitted → Approved / Rejected**, with a per-project CO number.
- **admin/staff**: create, edit, submit, delete; approve/reject; revert.
- **client** (project member): view all + **approve/reject Submitted** COs only.
- **trade_partner**: no access (tab hidden + API 403).

**Budget integration:** approving a CO creates a budget line in its target category
(`CO #<n>: <title>`) with the cost impact as the budgeted amount (negative = credit),
so it flows into the Budget rollup. This runs in a DB transaction. Reverting an approved
CO (admin/staff) does **not** delete the line — it flags it `[REVERTED] ...` and zeroes it,
preserving history; re-approving restores it. Re-approves never double-add (idempotent).

Note: a CO needs a target **budget category**, so a project must have its Budget set up
(categories seeded) before creating change orders.

## Deploy steps
1. Copy files in, then from the repo folder:
   ```
   git add .
   git commit -m "Phase 2 (Tier 2): Change Orders"
   git push
   ```
2. Railway redeploys; look for `Phase 2 migration (change orders) complete` in the logs.
   **No new env vars.**
3. Test: open a project (with a Budget already set up) → **Change Orders** →
   New → Submit → Approve → then check the **Budget** tab shows the new `CO #…` line.
   Then Revert it and confirm the budget line goes to `[REVERTED]` / $0.

## Remaining Phase 2
- Tier 2: Daily Logs (next)
- Tier 3: RFIs & submittals, Notifications/email
- Still pending: add real client + trade_partner test users (good time — CO approval is
  the first client-writable action to verify live).
