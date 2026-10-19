# Audiences and broadcast campaigns

Organization contacts are canonical email identities. Audience memberships hold subscription state, tags, consent source, and append-only lifecycle history. Campaigns store saved text drafts and durable recipient snapshots. The app, control API, TypeScript SDK, and management MCP use the same contracts in `packages/mail/src/audiences.ts`, `campaigns.ts`, and `control.ts`.

## Access and routes

The app exposes `/audiences`, `/audiences/:audienceId`, `/campaigns`, and `/campaigns/:campaignId` for the selected team. Organization members can read; owners and admins can manage audiences, edit drafts, and send campaigns.

Create a key in the team's API key settings and explicitly select its audience and campaign permissions. New keys start without these permissions, and existing transactional keys do not gain them automatically. The authenticated `organizationApiKeys.create` procedure accepts `organizationId`, `name`, `expiresIn` (seconds or `null`), and this permissions shape:

```json
{
  "audiences": ["read", "write"],
  "campaigns": ["read", "write", "send"]
}
```

Permissions are independent: sending does not implicitly grant reading or editing. Key creation requires owner/admin access and the API-key billing entitlement. Store returned keys in the intended secret store; the management API derives the organization from the authenticated key rather than accepting a caller-selected organization.

| Scope | Control operations |
| --- | --- |
| `audiences:read` | `audiences.list`, `get`, `listContacts`, `listHistory`, `listSegments` |
| `audiences:write` | `audiences.create`, `update`, `registerContact`, `importContacts`, `updateContact`, `unsubscribeContact`, `resubscribeContact`, `removeContact`, `setSuppression`, `createSegment`, `updateSegment`, `deleteSegment` |
| `campaigns:read` | `campaigns.list`, `get`, `preview` |
| `campaigns:write` | `campaigns.create`, `update` |
| `campaigns:send` | `campaigns.send`, `cancel`, `retry` |

Each abbreviated operation in a row retains its `audiences.` or `campaigns.` prefix. Send JSON to `POST /api/v1/control` with `Authorization: Bearer <key>` and `Content-Type: application/json`:

```json
{
  "operation": "campaigns.list",
  "input": { "limit": 50, "offset": 0 }
}
```

The response is the operation result directly, without a result envelope. Audience lists use `cursor`/`nextCursor`; campaign lists and recipient reports use `offset`/`nextOffset`. Page sizes are capped at 100. `campaigns.get` accepts an optional recipient `status` filter and includes progress counts, delivery counts, recipient outcomes, and recent delivery events. Request bodies are bounded to 1 MiB.

Connect a remote MCP client to `/api/v1/control/mcp` using the same bearer key. Discovery includes only authorized tools, named with underscores, such as `audiences_list` and `campaigns_preview`. MCP calls use the same validation, tenant checks, idempotency, and explicit send confirmation as the API. Tool results also include a structured `{ "result": ... }` value.

## SDK workflow

The `quieter` package exposes typed `audiences` and `campaigns` methods. Supply the key from your application's secret configuration; `baseUrl` can select an approved development endpoint.

```ts
import { Quieter } from "quieter";

const client = new Quieter({ apiKey: managementKey });
const audience = await client.audiences.create({
  idempotencyKey: "newsletter-audience-2026-10",
  name: "Product updates",
});
await client.audiences.registerContact({
  audienceId: audience.id,
  channel: "api",
  consentSource: "Product updates signup form",
  email: "reader@example.com",
  idempotencyKey: "signup-unique-event-id",
  tags: ["product"],
});
const draft = await client.campaigns.create({
  audienceId: audience.id,
  from: "Updates <updates@example.com>",
  name: "October updates",
  segmentIds: [],
  subject: "October product updates",
  text: "Here are this month's updates.",
});
const review = await client.campaigns.preview({ campaignId: draft.id });
```

The sender must use a domain verified for this team. Show the saved content, sender, selected audience/segments, eligible and excluded counts, and estimated cost before asking for send confirmation. After that confirmation, use the reviewed values:

```ts
await client.campaigns.send({
  campaignId: draft.id,
  confirmed: true,
  expectedUpdatedAt: draft.updatedAt,
  idempotencyKey: "october-campaign-confirmation-unique-id",
  previewToken: review.previewToken,
});
const report = await client.campaigns.get({ campaignId: draft.id });
```

Preserve the same confirmation key and input when retrying an interrupted request. Changed input under a used key conflicts. Draft updates also require `expectedUpdatedAt`. The preview token covers the draft, recipient eligibility, and segment criteria; a changed audience or draft requires a fresh review before sending. Multiple `segmentIds` form a union without duplicate recipients; an empty array targets the whole audience. Each segment supports `allTags`, `anyTags`, and `excludeTags`.

## Consent, import, and unsubscribe

CSV/paste import previews rows before mutation and accepts at most 500 contacts per request. The API accepts `rows` plus `audienceId`, `consentSource`, and an `idempotencyKey`, returning row-level validation and duplicate outcomes. Email addresses are normalized. Reusing an import key returns its previous result; changed input conflicts.

Registration and import never restore an unsubscribed or removed membership. Explicit resubscription requires `consentConfirmed: true`, a fresh `occurredAt`, and `consentSource`. Lifecycle events retain occurrence time, recording time, actor, channel, source, and reason, including stale changes that were not applied.

Audience subscription and organization safety suppression are separate. Resubscribing does not clear a bounce, complaint, manual block, or other safety suppression. `setSuppression` is a separate audited action. Campaign eligibility requires both an active subscription and no current suppression.

Every broadcast includes a visible unsubscribe footer and RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers. `/api/v1/unsubscribe/:token` uses an opaque recipient capability. GET displays a confirmation form and never changes subscription. A form POST containing `List-Unsubscribe=One-Click` unsubscribes that audience without login or redirect. It records an audience event and delivery evidence without globally suppressing the address. Treat capability URLs as secrets and exclude them from logs and screenshots.

## Delivery and recovery

Confirmation atomically freezes content, selection criteria, and recipient eligibility while holding the audience lock. The snapshot is capped at 10,000 contacts, including excluded contacts. Membership changes and snapshot creation have a defined serialized order. Late eligibility and suppression checks run again immediately before submission.

The browser only observes progress. A bounded server processor claims campaigns with leases, uses stable private send keys per recipient, and reuses verified-sender checks, billing credit reservations, raw-message storage, and delivery feedback. Durable recipient state survives transactional send-record retention. Known unsubmitted or rejected attempts can retry; unknown provider acceptance remains `uncertain` and is never automatically resent. A campaign with unresolved delivery or exhausted safe retries is `paused`; `campaigns.retry` resumes only safely failed recipients. Later acceptance reconciles durable results.

Cancel stops pending work. A message already being submitted may still be accepted; cancellation preserves its result. Stale in-flight work is reconciled after the lease expires, with uncertain acceptance retained for investigation. Do not replace an uncertain campaign with a new broadcast to the same recipients.

`CampaignProcessor` in `infra/mail.ts` runs an AWS cron every minute with bounded concurrency. Its handler initializes `DATABASE_URL`, R2 credentials, `POLAR_ACCESS_TOKEN`, and `SENTRY_DSN` from linked SST Secrets, uses the canonical app origin for HTTPS unsubscribe links, and receives mail-send permissions and the outbound feedback configuration. It runs send recovery before processing a batch. Production deployment and secret changes require the protected workflows described in [Deployment](deployment.md).

## Local operation and rollout

Follow [Development](development.md) for the ignored development environment, allowlisted `quieter_dev` database, migrations, and `vp run env:doctor`. Start the app and local workers using the existing development commands. With the local worker running at `127.0.0.1:8787`, inspect one bounded batch using:

```bash
vp run dev:trigger campaigns
```

This invokes `POST /__dev/campaigns` using the configured local-worker token. The endpoint is local-only, rejects browser-origin requests, and hardcodes `dryRun: true`; request input cannot enable sending. The result reports `considered`, `eligible`, `excluded`, and `processed: 0` without claiming work or changing delivery state. Queue a reviewed campaign against development data to inspect pending recipients; an empty queue returns zero counts. Local deployment mode hard-blocks real delivery. Do not change deployment mode to bypass that guard. Real delivery verification requires an approved deployed development setup and dedicated test recipients.

The initial additive migration is `20261019215405_fresh_stone_men`. The follow-up `20261019215649_large_tattoo` carries the `quieter:contract` marker and changes the campaign-to-audience tenant foreign key to `ON DELETE CASCADE`, matching organization deletion behavior. Preserve both migrations in order and follow [Database safety](database-safety.md) for protected contract rollout. No production migration, deployment, or real provider send is claimed by this implementation work. Dry-run and bundle validation do not establish live delivery or feedback correctness.
