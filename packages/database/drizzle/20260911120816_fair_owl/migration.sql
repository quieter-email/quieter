-- quieter:contract
-- Removes the saved views feature. The deploy workflow applies this migration
-- before the replacement release is live, so saved view calls from the previous
-- release fail during the migration window; no backwards-compat release was
-- requested. Rollback to a release that reads saved views is not possible.
-- Reviewed and authorized on 2026-09-11.
DROP TABLE "managedMailSavedView";
