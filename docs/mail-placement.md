# Mail placement commands

Done removes handled incoming mail from Inbox without deleting messages. Gmail retains its native labels and managed mail stores `done` in its existing mailbox state. Message bodies, attachments, read state, custom labels and canonical thread IDs remain intact.

Placement is visible to everyone who can access a shared managed inbox. Managers and responders can change it. Readers cannot. Gmail remains private to its owner. These commands do not read or change personal reminders.

## Command contract

Single, bulk and All inboxes actions use `mail.applyChanges`. All inboxes resolves display IDs to canonical source IDs and groups requests by source mailbox.

```ts
await rpc.mail.applyChanges({
  mailboxId,
  requestId: crypto.randomUUID(),
  command: { kind: "set-placement", placement: "done" },
  targets: [{ threadId, messageIds }],
});
```

Use `placement: "inbox"` for Return to Inbox. It restores handled incoming mail. It does not rescue Spam or Trash, or alter sent messages and drafts.

The supplied message IDs are known conversation anchors. The server resolves incoming messages through the latest known anchor by provider receipt time, then persists that message set before dispatch. A new incoming reply remains outside the selected prefix and reopens the same conversation. Retrying a request never expands its message set.

Each target returns `status`, optional `operationId`, the resolved `messageIds`, and optional `code`, `message` and `replayed`. Partial bulk failures leave successful targets applied. A duplicate accepted request identity with changed command or targets conflicts. Duplicate receipts require current mailbox authorization.

New requests consume an actor-wide budget weighted by their supplied message anchors. Canonical mailbox/thread associations are checked under the mailbox reservation lock before target receipts are inserted. Invalid targets return a failure without a receipt. When a mixed batch has accepted targets, their immutable hash covers the entire batch; replay keeps absent targets rejected even if they later become available. A fully rejected batch creates no accepted intent. Existing accepted identities replay without new source admission or budget charges. Accepted, submitting and uncertain identity evidence is retained so cleanup cannot permit a repeated native effect.

Request identities permit at most one application dispatch. Reuse the original identity only to inspect its receipt. A lost or uncertain result requires a source refresh before a fresh explicit action. Replayed receipts invalidate queries instead of applying an old optimistic transformation. The existing mailbox mutation coordinator orders overlapping client intents and keeps mailbox IDs in every cache write.

## Inbox and Done membership

Inbox includes conversations with active incoming mail. Done includes handled incoming mail only when the conversation has no incoming Inbox message. A new reply removes the conversation from Done and returns it to Inbox. Older handled messages remain in the same conversation history.

Done uses the normal canonical list and enrichment path in both providers. Search within Done keeps supported existing filters. Its rows retain sender details, attachments, counts and source mailbox identity. Unread and importance remain independent of handling.

## Ordering and uncertainty

A durable operation receipt binds the actor, mailbox, immutable request hash, thread and resolved message set. Server sequence orders accepted placement intents. Newer intents supersede older reservations before dispatch. Legacy native placement actions invalidate pending reservations before their effects.

Gmail cannot commit atomically with PostgreSQL and has no conditional label mutation or remote request identity. An ambiguous native effect is recorded as uncertain and never automatically redispatched. A request already accepted by Gmail can still finish after a process failure. Current source refresh and a new explicit user action provide recovery. Live behavior requires a dedicated test mailbox with exclusive watch and mutation ownership.

## Release order

The managed-state expansion and operation table must exist before the new application writer runs. Apply the reviewed expansion through the protected deployment workflow. This feature does not apply migrations to shared development or production databases.

## Local verification

The focused receipt suite uses real PostgreSQL and deterministic authorization and provider transports. It runs only with `QUIETER_TEST_PLACEMENT_DATABASE_URL`, rejects non-loopback hosts, and requires the database name `placement_fixture`. Use a disposable database, never the shared development database. The suite creates and resets only its fixture tables.

```bash
QUIETER_TEST_PLACEMENT_DATABASE_URL=postgresql://postgres:fixture-password@127.0.0.1:5432/placement_fixture vp test packages/orpc/tests/mail-placement.test.ts
vp test packages/orpc/tests/mail-placement-model.test.ts packages/gmail/tests/service.test.ts packages/app/src/lib/mail/inbox-query/actions.test.ts
```

These fixtures cover receipt replay after a newer decision, actor and mailbox scope, weighted admission, rejected and partial batches, older pending intents, legacy placement during admission, protected native state, ambiguous provider effects, and receipt-time message selection. They do not prove live Gmail behavior. Use the existing Gmail and managed preview personas for browser controls, search and responsive styling. Stop only the preview and fixture processes owned by the verification run.
