# Outlook mail development

The QUIETER-214 implementation provides private, read-only mail services and a synthetic native fixture. It consumes the additive Outlook tables and dedicated optional mail secrets. The connection router remains unregistered until the checked canonical enrichment and admission joins are complete. A callback route or successful fixture does not establish public availability or Microsoft consent.

## Configuration

Use a separate Microsoft mail application registration. Identity and Calendar registrations, tokens and scopes do not authorize mail access. The implemented authority is Microsoft's global `common` v2 endpoint, with delegated `openid profile offline_access User.Read Mail.Read`. Shared/delegated mailboxes, sovereign clouds and provider writes are unsupported.

Configure these development SST Secrets through the existing linked-secret workflow. Application reads belong to `@quieter/env`.

| SST Secret                      | Server configuration                |
| ------------------------------- | ----------------------------------- |
| `OutlookMailClientId`           | `OUTLOOK_MAIL_CLIENT_ID`            |
| `OutlookMailClientSecret`       | `OUTLOOK_MAIL_CLIENT_SECRET`        |
| `OutlookMailTokenEncryptionKey` | `OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY` |

Use an independent high-entropy mail encryption secret. The implementation supplies that key explicitly to the existing AES-GCM primitive. It never selects Gmail, identity or Calendar credentials. Keep refresh/access tokens and the encryption secret server-side. Inactive deployments may leave all three absent. Missing or partial configuration rejects connection before OAuth state or cryptographic work. Run `vp run env:doctor` after approved local configuration changes.

The registered web redirect must be the application origin plus `/api/outlook/callback`. A development loopback origin is supported. Hosted origins require HTTPS. The callback binds the state to the authenticated user, session, nonce, PKCE verifier and originating organization; reconnect additionally binds the retained account identity and credential generation. Return paths remain local. Do not use production credentials to satisfy development setup.

After the retained root registration is reviewed, `outlook.startConnection` takes the current organization and an optional owned mailbox for reconnect. `outlook.status` reports configuration and connection state. `outlook.disconnect` cancels pending/claimed connection receipts before removing the owner's mailbox. There is no connection control in this source unit. Its eventual UI mount and browser/session verification remain explicit integration work.

## Synthetic native fixture

The opt-in config is `packages/orpc/tests/outlook-native.config.ts`. Ordinary `vp test` discovery excludes its `.fixture.ts` files. The fixture substitutes authenticated session identity and Microsoft HTTP/token/OIDC responses; ORM, migrations, receipt admission, capacity, cache, authorization, crypto and signature validation use actual source. All other external transport is refused.

Run only against a new disposable PostgreSQL database with the committed native search extensions. Reuse the image built from `infra/docker/semantic-search-postgres.Dockerfile`; ordinary PostgreSQL images do not provide all required migration dependencies. The program's reviewed runner records exact source hashes, resource limits, execution and cleanup in its lane receipt. No shared database is a valid target.

The dedicated config requires all of the following:

- A fresh database named `quieter_outlook_native_214_` followed by a random twelve-character lowercase hexadecimal run ID.
- The same run ID in `QUIETER_OUTLOOK_NATIVE_RUN`, and `QUIETER_DEPLOYMENT_ENV=local`.
- A password-authenticated `outlook_fixture` user on `127.0.0.1`, using an explicit unused port other than 5432 or 6432.
- No inherited `SST_RESOURCE_` bindings or real provider/model credentials.

Global setup refuses existing public or migration-ledger tables, runs the existing full forward-migration tool, then verifies the ledger and owner compound foreign keys. It never resets a database. The config generates dedicated test-only mail secrets and uses one worker and the actual local application pool of one.

With the reviewed disposable fixture allocated and its sanitized environment set, the execution command is:

```sh
vp test run --config packages/orpc/tests/outlook-native.config.ts
```

The current program runner caps its container at 512 MiB and one CPU, bounds each process to 180 seconds, requires at least 3 GiB available host memory and disk, and removes its exact owned container and ephemeral credentials afterward. The database server permits at most three connections. One deliberate race uses a second isolated application pool and a third lock witness; other cases use the normal pool of one. Passing assertions require a successful cleanup receipt as separate evidence.

The fixture covers current ownership and membership, mailbox identity collisions, leases/generations, opaque revision CAS, complete-thread deletion, attachment/body coherence, count coverage, encrypted continuations, callback replay/session binding, disconnect cancellation, full-capacity reconnect, wrong identities/providers, receipt lock order and organization relocation. Inspect actual execution results before claiming any case passed.

## Read and recovery contracts

Initial and incremental synchronization process bounded slices. A request performs at most one folder-discovery page and one folder-message page. Continuations remain encrypted server records bound to actor, mailbox, query and credential generation. Expired provider state starts reconciliation; duplicate leases and stale writes fail without restoring retired membership. Provider change keys are equality tokens.

List results disclose incomplete cache/search coverage. Unread thread counts and their coverage come from one database snapshot. Complete conversation reads follow every bounded page before retiring absent members. A body/attachment revision conflict produces a recoverable error rather than caching an inconsistent result. Search translates the supported shared expression subset entirely or rejects the expression; it does not silently drop filters. See [the provider contract](outlook-mail.md) for account and search limits.

Disconnected or revoked credentials require a new owned connection. Reconnect must use the same external account. Callback failures never make their consumed receipt reusable; begin a new attempt. Public Outlook mail semantic search is explicitly unsupported until its source identity and embedding-storage joins are reviewed. Private memory and chat keep their established actor-owned semantics.

Canonical captured snapshots use the shared mail analysis version and retain optional headers, attachments, reply anchors and source metadata. G owns the importance, personal-memory and semantic mounts. Root router registration, their current-authority checks and their exact checked integration head remain public-admission prerequisites. This unit creates no receive processing or write capability.

## Remaining acceptance

Dedicated Microsoft application registration, account selection, consent, real page/open/search/attachment reads, upstream changes, revocation and reconnect require an assigned development account and explicit execution ownership. Synthetic responses do not establish those outcomes. A browser/resource slot is also required for the connection and mailbox UI checks. QUIETER-219 writes retain their shared workflow prerequisites; QUIETER-222 notifications and release acceptance retain their own blockers. No deployment, production migration, native installation or release is implied.
