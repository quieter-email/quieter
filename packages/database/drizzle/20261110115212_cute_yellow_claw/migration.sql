-- quieter:contract
ALTER TABLE "managedMailRule" ADD CONSTRAINT "managed_mail_rule_archive_removed_check" CHECK (not ("actions" @> '[{"kind":"move","destination":"archive"}]'::jsonb));--> statement-breakpoint
ALTER TABLE "managedMailRuleBackfill" ADD CONSTRAINT "managed_mail_rule_backfill_archive_removed_check" CHECK ("status" in ('completed', 'cancelled') or not ("definition"->'actions' @> '[{"kind":"move","destination":"archive"}]'::jsonb));--> statement-breakpoint
ALTER TABLE "managedMailRuleRun" ADD CONSTRAINT "managed_mail_rule_run_archive_removed_check" CHECK (not ("definition"->'actions' @> '[{"kind":"move","destination":"archive"}]'::jsonb));
