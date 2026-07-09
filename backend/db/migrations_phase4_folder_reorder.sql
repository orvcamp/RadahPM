-- ============================================================
-- RADAH PM PLATFORM — Migration: RENAME FOLDER TEMPLATE (reorder)
-- ============================================================
-- One-time data fix. The standard folder template's top-level folder
-- names were renumbered (Subcontractors/Procurement elevated after
-- Preconstruction, Closeout moved to last). Deploying that code change
-- alone does NOT rename folders that already exist on live projects —
-- ordering is purely alphabetical by name, so existing rows keep
-- sorting in the old order until their names are actually updated.
--
-- Only renames TOP-LEVEL folders (parent_folder_id IS NULL). Children
-- (e.g. "Prequalification" under Subcontractors) keep their names —
-- only their parent's numeric prefix changed.
--
-- Idempotent: after the first run, the old names no longer exist, so
-- re-running matches zero rows and does nothing.
-- ============================================================

UPDATE document_folders SET name = '02 - Subcontractors'
  WHERE name = '11 - Subcontractors' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '03 - Procurement'
  WHERE name = '12 - Procurement' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '04 - Drawings & Specifications'
  WHERE name = '02 - Drawings & Specifications' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '05 - Submittals'
  WHERE name = '03 - Submittals' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '06 - RFIs'
  WHERE name = '04 - RFIs' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '07 - Change Management'
  WHERE name = '05 - Change Management' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '08 - Cost & Billing'
  WHERE name = '06 - Cost & Billing' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '09 - Field & Logs'
  WHERE name = '07 - Field & Logs' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '10 - Safety'
  WHERE name = '08 - Safety' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '11 - Quality (QA-QC)'
  WHERE name = '09 - Quality (QA-QC)' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '12 - Logs & Registers'
  WHERE name = '13 - Logs & Registers' AND parent_folder_id IS NULL;

UPDATE document_folders SET name = '13 - Closeout'
  WHERE name = '10 - Closeout' AND parent_folder_id IS NULL;

-- 00 - Project Management and 01 - Preconstruction & Contracts are unchanged, no update needed.
