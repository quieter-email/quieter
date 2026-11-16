# Shared mailbox collaboration contract

Collaboration applies to existing shared managed mailboxes. Current mailbox grants and current organization membership authorize every request. Private managed mailboxes and Gmail do not expose this contract. An assignment, mention, note author or copied link never grants access.

| Current role | Read state and team notes | Write own notes, claim or release self | Assign others or moderate notes |
| --- | --- | --- | --- |
| Reader | Yes | No | No |
| Responder | Yes | Yes | No |
| Manager | Yes | Yes | Yes |

The foundation router exposes `collaboration.get`, `collaboration.prepare` and `collaboration.changes`. `get` does not create a record. A responder or manager can prepare a context idempotently. The context has a generation ID and decimal revision. The first preparation stores one metadata-only audit event. Assignment and note operations belong to their own features.

`changes` is a short authenticated polling request. Every response rechecks current role, membership and thread existence and returns fresh permissions. A replaced generation or impossible future revision requires a cache reset. Clients must honor the returned permissions even when the revision has not changed. Reconnect requires an authorized read before showing cached team content. No team content is sent through the existing user websocket.

Links use the authenticated `/?mailboxId=...&threadId=...` route. Both values are URL encoded. The URL contains no access token and the destination RPC checks current access.

Collaboration records and audit events are separate from email bodies, outbound MIME, personal reminders, AI memory and private Action results. Audit metadata contains operation kind, revision, timestamp and nullable membership reference. Later collaboration mutations retain only the latest 500 metadata events per context.

Short transactions pin the organization, current actor membership and mailbox before acquiring the thread's advisory lock. The membership and mailbox pins do not wait for concurrent access changes. Contention returns a retryable conflict and rolls back the complete operation. They use READ COMMITTED and check current authorization after locking and before returning. An already authorized in-flight operation can finish around a simultaneous revocation. Later requests cannot retain authority through stored collaboration records.

Mailbox deletion cascades context and audit. Physical last-message deletion or movement out of the source thread removes the old context through coordinated storage cleanup. Recreating that source identity creates a new generation. Moving a conversation to Trash or Done preserves its collaboration. The storage migration and native concurrency fixture are required integration points; source-only checks do not verify that lifecycle.

The isolated PostgreSQL profile is `packages/orpc/vite.collaboration-native.config.ts`. It runs the real protected router, service, current grant queries and migrated lifecycle triggers against an explicitly provided loopback database named `collaboration_fixture`. Apply the actual migration chain to that disposable database first, then provide its URL as `QUIETER_TEST_COLLABORATION_DATABASE_URL` and run:

```bash
vp test --config packages/orpc/vite.collaboration-native.config.ts --maxWorkers=1 --no-file-parallelism
```

The profile uses synthetic sessions and owned fixture rows. It uses two connections normally and a third for controlled lock races, with no schema reset or provider calls. The account-cleanup race covers its SQL lock sequence, excluding billing preflight. Browser cookies, UI caches and Worker sockets require their own verification.
