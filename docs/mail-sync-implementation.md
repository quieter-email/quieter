# Mail sync implementation

Implementation is in progress. This tracks the work against [the design](custom-mail-sync-engine-plan.md), including decisions made after that document was written.

The engine lives in separate packages. Existing application code connects through explicit adapters, transaction hooks, and UI adapters. Avoid distributing protocol, persistence, and transport decisions throughout existing services.

| Package | Responsibility |
| --- | --- |
| `@quieter/sync` | Provider-neutral wire contracts and pure reconciliation rules |
| `@quieter/sync-server` | Transactional projection, log, outbox, snapshots, replay, commands, body storage contracts, provider adapters |
| `@quieter/sync-client` | Browser replica, persistence, scheduler, transport, cache policy |
| `@quieter/sync-worker` | Dedicated Cloudflare runtime, Durable Objects, delivery and recovery |
| `@quieter/orpc` | Thin authorization and existing domain-operation bridge |

The server package receives a database client and delivery/body-storage dependencies. It does not import the application API or UI. Provider adapters are separate entry points so the delivery runtime does not load their dependency graphs unnecessarily.

Saving a provider change and appending its sync batch remain in one database transaction. After commit, the bridge sends that exact batch directly to the delivery runtime. The normal delivery path does not read PostgreSQL again.

Current work:

- [x] Protocol and reference-model tests
- [x] Transactional repository, migrations, snapshot/replay and outbox tests
- [x] Dedicated Cloudflare runtime and native Worker tests
- [ ] Managed provider adapter and explicit mutation hooks
- [ ] Gmail adapter, history/import/recovery and watch ownership
- [ ] Durable commands, draft conflict handling, delivery feedback
- [ ] Browser persistence, bounded cache, hydration and prefetch
- [ ] UI/query adapters, lifecycle, permissions and cache controls
- [ ] Local setup, fixtures and operational documentation
- [ ] End-to-end verification, boundary/bundle checks, complete workspace checks
- [ ] Reviewed migration and deployment handoff, canary requirements

Production migrations and deployment remain protected operations. Implementation does not run them locally.
