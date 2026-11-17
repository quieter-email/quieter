# Shared mailbox collaboration contract

Collaboration applies to existing shared managed mailboxes. Current mailbox grants and current organization membership authorize every request. Private managed mailboxes and Gmail do not expose this contract. An assignment, mention, note author or copied link never grants access.

| Current role | Read state and team notes | Write own notes, claim or release self | Assign others or moderate notes |
| --- | --- | --- | --- |
| Reader | Yes | No | No |
| Responder | Yes | Yes | No |
| Manager | Yes | Yes | Yes |

The foundation router exposes `collaboration.get`, `collaboration.prepare` and `collaboration.changes`. `get` does not create a record. A responder or manager can prepare a context idempotently. The context has a generation ID and decimal revision. The first preparation stores one metadata-only audit event. Assignment operations remain a separate feature. The notes routes below use this same registered context and authorization contract.

`changes` is a short authenticated polling request. Every response rechecks current role, membership and thread existence and returns fresh permissions. A replaced generation or impossible future revision requires a cache reset. Clients must honor the returned permissions even when the revision has not changed. Reconnect requires an authorized read before showing cached team content. No team content is sent through the existing user websocket.

Links use the authenticated `/?mailboxId=...&threadId=...` route. Both values are URL encoded. The URL contains no access token and the destination RPC checks current access.

Collaboration records and audit events are separate from email bodies, outbound MIME, personal reminders, AI memory and private Action results. Audit metadata contains operation kind, revision, timestamp and nullable membership reference. Later collaboration mutations retain only the latest 500 metadata events per context.

Short transactions pin the organization, current actor membership and mailbox before acquiring the thread's advisory lock. The membership and mailbox pins do not wait for concurrent access changes. Contention returns a retryable conflict and rolls back the complete operation. They use READ COMMITTED and check current authorization after locking and before returning. An already authorized in-flight operation can finish around a simultaneous revocation. Later requests cannot retain authority through stored collaboration records.

Mailbox deletion cascades context and audit. Physical last-message deletion or movement out of the source thread removes the old context through coordinated storage cleanup. Recreating that source identity creates a new generation. Moving a conversation to Trash or Done preserves its collaboration. The storage migration and native concurrency fixture are required integration points; source-only checks do not verify that lifecycle.

## Internal notes and mentions

`collaboration.notes.list` reads a stable page for one mailbox and thread. `get` reconciles one generated note ID after an uncertain response. `participants` lists current organization memberships that can access that mailbox. `mutate` creates, edits or removes a note with an expected context generation and revision. A stale cursor returns a conflict without rebasing or overwriting another change.

Notes are plain text, including line breaks, with a maximum of 10,000 Unicode code points. A responder or manager can edit their own note from the same membership. A manager can remove another member's note but cannot rewrite it. A departed author's reference becomes null. Joining again creates a different membership and does not reclaim the old author's rights. Each note response carries current edit and remove actions, which can change without a context revision change.

Mention targets are explicit selected membership IDs. The server checks every selected target's current mailbox access and pins its exact current membership without waiting before writing foreign keys. It checks current actor and recipient grants again before commit. A retained mention preserves its original creation and acknowledgement state. Removing a target deletes that fact. Adding the target again creates a new unread fact. Deleting a note or recipient membership removes the corresponding facts.

`collaboration.mentions.list` is a mailbox-wide unread recipient feed. Its links contain scope identifiers but no note body, sender or access token. `acknowledge` affects only the authenticated recipient's fact and does not change the team revision or audit stream. Mention facts grant no access. Switching a managed mailbox to private denies all notes and mention paths while retaining organization data for a later shared state with current grants.

The isolated App leaves are `ThreadNotes` and `CollaborationMentions` under `@quieter/app/features/collaboration-notes/`. Their parent mounts must place internal notes outside the external reply form and compose surface. The mention caller supplies the complete accessible shared managed mailbox catalog, including mailboxes other than the currently selected mailbox. Notes query state and captured drafts stay in memory. A reconnect closes the authority epoch and hides cached content until an authorized read succeeds. Current per-note actions govern edit and remove attempts, including when the context revision is unchanged. The client Store retains write and moderation restrictions from each current scoped response, including participant lookup and uncertain-create validation. Missing reconnect data hides a draft without discarding it. A real authorization read can recover permissions through a new epoch, preserving valid author drafts while retiring older requests.

A last-source deletion or movement, mailbox deletion, or organization deletion removes notes through the context lifecycle. Moving a conversation to Trash or Done preserves notes. Notes and mention facts never enter outgoing mail, AI memory, reminders or the user websocket. Audit events retain note IDs and operation metadata without note bodies or mention read state.

## Isolated native verification

The isolated PostgreSQL profile is `packages/orpc/vite.collaboration-native.config.ts`. It runs the real protected router, service, current grant queries and migrated lifecycle triggers against an explicitly provided loopback database named `collaboration_fixture`. Apply the actual migration chain to that disposable database first, then provide its URL as `QUIETER_TEST_COLLABORATION_DATABASE_URL` and run:

```bash
vp test --config packages/orpc/vite.collaboration-native.config.ts --maxWorkers=1 --no-file-parallelism
```

The profile covers foundation and notes API authorization, optimistic writes, membership epochs, mention acknowledgement and retention, recipient funding lock contention, final grant revocation rollback, source lifecycle, and cross-mailbox isolation. It uses synthetic sessions and owned fixture rows. It uses two connections normally and a third for controlled lock races, with no schema reset or provider calls. The account-cleanup race covers its SQL lock sequence, excluding billing preflight. Browser cookies, UI caches and Worker sockets require their own verification.
