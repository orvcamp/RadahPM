# Project Tabs — Grouped & Stage-Aware (frontend only)

The flat row of 10 tabs is now organized into four consistent groups, with the
current stage HIGHLIGHTING the most relevant tabs. Nothing is ever hidden by
stage, so live records (an RFI still open at Closeout, say) are never orphaned
behind a tab that disappeared.

## Groups (same on every project)
- Overview  — Timeline, Tasks, Schedule, Team
- Documents — Documents
- Cost      — Budget, Change Orders        (Billing slots in here when built)
- Field     — Daily Logs, RFIs, Submittals (Punch List / Reports slot in here)

## Stage highlighting (surfaces, never hides)
A small gold dot marks the tabs most relevant to the project's current stage:
  Lead                   → Timeline, Tasks, Team, Documents
  Preconstruction        → Schedule, Budget, RFIs, Submittals, Documents
  Mobilization           → Schedule, Team, Submittals, Documents
  Construction           → Daily Logs, RFIs, Submittals, Change Orders, Budget
  Substantial Completion → Change Orders, Budget, Documents, Daily Logs
  Closeout               → Documents, Budget, Change Orders
  Complete               → Documents, Budget
A legend under the tabs explains the dot.

## Unchanged
Role and module gating are exactly as before — trade partners still never see
Cost tabs; disabled modules still hide their tab entirely. A group with no
visible tabs is omitted.

## Files (both frontend)
frontend/src/config.js  (TAB_GROUPS, TAB_LABELS, STAGE_RELEVANT_TABS)
frontend/src/pages/ProjectDetailPage.jsx  (grouped tab rendering)

## Deploy
git add . && git commit -m "Group project tabs; stage-aware highlighting" && git push
No migration, no backend change, no env vars.

## Adding future modules
Add the key to the right group in TAB_GROUPS, a label in TAB_LABELS, and list it
under the stages where it matters in STAGE_RELEVANT_TABS.
