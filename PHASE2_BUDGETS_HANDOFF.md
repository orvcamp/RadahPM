# RADAH PM — Phase 2: Budgets & Cost Tracking (deploy note)

## What's in this drop (new + changed files only)
Copy these over your repo — they mirror your existing structure, so they add the
new files and overwrite the two changed ones. Nothing else is touched.

**New:**
- `backend/db/migrations_phase2_budgets.sql` — budget tables (additive, safe to re-run)
- `backend/routes/budget.js` — budget API (categories, lines, commitments, expenses, rollup)
- `frontend/src/components/BudgetTab.jsx` — the Budget tab UI

**Changed:**
- `backend/db/migrate.js` — now also runs the budgets migration
- `backend/server.js` — mounts the budget routes
- `frontend/src/pages/ProjectDetailPage.jsx` — adds the Budget tab (hidden for trade partners)

## Design
Four-column construction cost control per line: **Budgeted / Committed / Actual / Remaining**
(Remaining = budgeted − committed − actual).
- **Budget lines** = the plan (a budgeted amount, in a category).
- **Commitments** = POs / subcontracts (only *open* ones count as committed).
- **Expenses** = actuals; every expense must attach to a budget line.
- Categories are seeded per project (Labor, Materials, Permits, Equipment, Subcontractor,
  Other) and admins can add/rename/remove them.
- Money is stored as integer **cents**; the UI works in dollars.

## Permissions
- **admin/staff**: full edit.
- **client**: read-only (sees their project's budget).
- **trade_partner**: no budget access — tab hidden in UI *and* blocked by the API (403).

## Deploy steps (same flow as before)
1. Copy the files in, then from your repo folder:
   ```
   git add .
   git commit -m "Phase 2: Budgets & cost tracking"
   git push
   ```
2. Railway auto-redeploys. On boot, `npm run migrate` runs the new migration and you should
   see `Phase 2 migration (budgets) complete` in the deploy logs. **No new env vars** and
   **no R2 / bucket changes** are needed for this module.
3. Test: open a project → **Budget** tab → **Set Up Budget** (seeds default categories) →
   add a line → add a commitment and an expense on it → confirm the rollup and totals update.

## Known, intentional behavior
- Deleting a budget line keeps its commitments/expenses but leaves them unassigned (no cost
  history is destroyed). Unassigned costs drop out of the per-line and total rollups until
  reassigned — so the visible table always reconciles with the totals.
- Deleting a category is blocked while any line still uses it (move/clear those lines first).

## Still pending from earlier (unchanged)
- Add real client + trade_partner test users and verify role permissions live (now a good
  time, since Documents + Budgets both have client/trade-partner-visible behavior to check).

## Remaining Phase 2 after this
- Tier 2: Change orders, Daily logs
- Tier 3: RFIs & submittals, Notifications/email
