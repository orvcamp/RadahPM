-- ============================================================
-- RADAH PM PLATFORM — Migration: DEDUPE FOLDERS + PREVENT RECURRENCE
-- ============================================================
-- Fixes duplicate document_folders created by re-running the standard
-- folder template after names changed (or by double-submitting the
-- "Set Up Standard Folders" button) — the endpoint had no protection
-- against either case, and the table had no uniqueness constraint.
--
-- Step 1: merge duplicates safely. For every group of folders sharing
-- the same (project_id, parent_folder_id, name), keep the oldest one
-- and reassign anything pointing at the others — documents filed
-- directly in them, and any child folders nested under them — before
-- deleting the now-empty duplicates. Two passes: the first merges
-- duplicate TOP-LEVEL folders (which also reunites their children
-- under one parent); the second catches any child-level folders that
-- are now duplicates of each other as a result of that reunion.
--
-- Step 2: add a real uniqueness constraint so this can't recur,
-- regardless of what the application code does or doesn't check.
-- ============================================================

DO $$
DECLARE
  dup RECORD;
  keeper_id UUID;
  pass INT;
BEGIN
  FOR pass IN 1..2 LOOP
    FOR dup IN
      SELECT project_id, parent_folder_id, name, array_agg(id ORDER BY created_at ASC) AS ids
        FROM document_folders
       GROUP BY project_id, parent_folder_id, name
      HAVING COUNT(*) > 1
    LOOP
      keeper_id := dup.ids[1];

      -- Move any documents filed in a duplicate over to the keeper.
      UPDATE documents SET folder_id = keeper_id
       WHERE folder_id = ANY(dup.ids[2:array_length(dup.ids,1)]);

      -- Move any child folders nested under a duplicate over to the keeper.
      UPDATE document_folders SET parent_folder_id = keeper_id
       WHERE parent_folder_id = ANY(dup.ids[2:array_length(dup.ids,1)]);

      -- The duplicates are now empty (nothing points at them) — remove them.
      DELETE FROM document_folders WHERE id = ANY(dup.ids[2:array_length(dup.ids,1)]);
    END LOOP;
  END LOOP;
END $$;

-- Prevent this from ever happening again, including under concurrent
-- requests. NULL parent_folder_id (top-level folders) is coalesced to a
-- sentinel so top-level duplicates are caught too — a plain UNIQUE
-- constraint would otherwise treat every NULL as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_folders_unique_name
  ON document_folders (
    project_id,
    COALESCE(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name
  );
