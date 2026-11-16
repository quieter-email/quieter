# Done semantic retention

Moving a managed conversation between Inbox and Done must preserve its existing semantic history. The previous invalidation trigger treated only active and retired archived messages as retained, so a Done write would delete otherwise current embeddings.

The forward migration changes only the managed trigger's retained-state comparison to active/done. Identity, content, subject, HTML and analysis comparisons remain unchanged. A's runtime eligibility predicate must accept the same retained states. Gmail invalidation is unchanged.

Apply this migration through the protected workflow before enabling Done writers. No shared development or production database was changed by this run. Rolling back Done consumers can preserve this trigger; restoring the old predicate would again invalidate embeddings on Done transitions. Previously deleted embeddings require normal reindexing.

Verification passed schema drift and migration safety checks, full fresh-chain creation and forward replay on the run-owned disposable PostgreSQL, and direct transactional assertions. Active/Done transitions preserve the existing embedding. Spam, Trash, draft, body, subject and HTML changes invalidate it. Independent source review found no actionable defect. The generated snapshot was not hand-edited.
