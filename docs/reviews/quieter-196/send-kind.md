# Send lifecycle discriminator

QUIETER-198 reuses the durable scheduled-send lifecycle for ordinary cancellable sends. The `scheduledMailSend.deliveryKind` field distinguishes existing scheduled delivery from the new held-send flow. Its default keeps older writers compatible. The existing operation identity, status, payload and receipt contracts remain unchanged.

## Application order

Review migration `20261115194949_chilly_garia` before applying it through the protected production workflow. Apply it before releasing code that selects the new field. Older application versions continue to insert scheduled sends after the migration.

The migration adds a required column with a constant default and a value constraint. Those operations need the repository's explicit contract-review marker. The constraint validates existing rows under an ALTER TABLE lock. Production lock duration has not been measured. No production or shared development migration was applied for this change.

## Verification

`vp run db:check` passes schema drift, migration history and safety checks. `vp run db:test-migrations` passes full-chain creation, repeat application and forward upgrade against a run-owned disposable loopback database.

`vp check --fix` passes with zero errors and the existing TanStack Virtual warning. `vp test --maxWorkers=2` passes all 172 test files and 1,360 tests.

A PostgreSQL transaction applied the generated migration to a temporary table with an existing row. Existing rows and inserts that omit the field receive the scheduled kind. An undo-kind insert succeeds. Unknown and null kinds fail their constraints. The transaction rolls back afterward.

Independent Sol review found and corrected the existing scheduled-send fixture's missing required select field. This preparation does not implement or establish acceptance of Undo Send, provider delivery, cancellation or its UI. B owns those outcomes in the dependent feature PR.
