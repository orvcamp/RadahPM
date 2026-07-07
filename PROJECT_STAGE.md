# Project Stage (lifecycle tracker) + Phases→Schedule rename

Adds a single "current stage" tracker per project, advanced like a stepper.
It's a visible status only (no gating), and is SEPARATE from the project Status
badge (planning/active/on hold/completed): Status = simple state, Stage =
construction lifecycle.

## Stages
Lead → Preconstruction → Mobilization → Construction → Substantial Completion → Closeout → Complete
(existing projects default to "Lead")

## What it does / where it shows
- A horizontal stepper on the project header. Admin/staff advance it with
  "Advance →" / "← Back", or click any step to jump. Others see it read-only.
- A "Stage: <name>" line under each project on the Projects list — status at a
  glance across the whole portfolio.

## Phases tab renamed to "Schedule"
Same functionality (schedule blocks / timeline planning), clearer name. The
empty-state now explains Schedule (planning the work) vs Stage (where the whole
job is now).

## New + changed files
New: backend/db/migrations_phase3_project_stage.sql
Changed: backend/db/migrate.js, backend/routes/projects.js (stage column +
         PATCH /projects/:id/stage), frontend/src/config.js (STAGES),
         frontend/src/pages/ProjectDetailPage.jsx (stepper + Schedule rename),
         frontend/src/pages/ProjectsPage.jsx (stage on list)

## Deploy
git add . && git commit -m "Project stage tracker + Phases->Schedule" && git push
Log should show: Migration (project stage) complete. No env vars.

## Test
Open a project → see the Stage stepper under the header (starts at Lead) →
click "Advance →" to move through stages → check the Projects list shows the new
stage under the project name. The Phases tab now reads "Schedule".
