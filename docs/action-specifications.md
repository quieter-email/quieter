# Action specification contract

`@quieter/ai/action-specification` defines the version 1 JSON document used by mailbox Actions. The contract imports only Zod and validates documents without an AI credential, database, connector, or background worker. The editor and runtime in `packages/orpc/src/mail-agent` resolve accounts, review capabilities, and execute incoming-mail or manual runs.

The old graph editor and runtime remain retired. Their retained action tables are rollback data. Settings show legacy action names as requiring review; they never become active specifications automatically.

## Persisted document

All fields are required, all objects reject unknown fields, and collections and text have size limits. Store the document as JSON only after server validation; revalidate loaded JSON before using it. Unsupported versions fail validation rather than being interpreted as version 1. Future versions need an explicit conversion and review policy.

| Field | Meaning |
| --- | --- |
| `version` | Literal `1`, identifying this serialization contract. |
| `mailboxId` | The single mailbox scope for mail and memory permissions. |
| `sourceText` | Original user instructions, preserved alongside the parsed interpretation. |
| `instructions` | Bounded instructions for the agent. They do not confer tool access. |
| `trigger` | One manual, mail-received, scheduled, or future-event trigger. |
| `connectors` | Stable `referenceId` and exact `connectionId` pairs, independent of provider names. |
| `permissions` | Named declarations with a scope and operation. Connector permissions also reference a declared connection. |
| `toolGrants` | Exact tool IDs linked to a declared permission and an explicit confirmation policy. |
| `review` | Human-readable parsed summary, assumptions, and questions. |

Mailbox and connector permissions support `read`, `write`, `send`, and `delete`. Memory permissions support `read`, `write`, and `delete`, scoped to this mailbox. Permission IDs, connector references, connection IDs, and each permission's target/operation must be unique. A tool can be granted separately for different connections, but conflicting grants for the same tool and target are rejected. Sending and deleting require `confirmation: "required"`.

Scheduled triggers declare a `daily` or `weekly` cadence, an `HH:mm` local time, and a named time zone. Weekly schedules also declare the weekday. There is no cron string, implicit system time zone, or scheduler in this contract. Execution work must define daylight-saving behavior and run deduplication before schedules are activated. Future-event triggers preserve an exact event type for review without claiming support for that source.

For example, this parsed document declares read access only:

```ts
import { validateActionSpecification } from "@quieter/ai/action-specification";

const result = validateActionSpecification({
  version: 1,
  mailboxId: "mailbox-private",
  sourceText: "When mail arrives, summarize it.",
  instructions: "Summarize the new message.",
  trigger: { kind: "mail_received" },
  connectors: [],
  permissions: [{ id: "mail-read", scope: "mailbox", operation: "read" }],
  toolGrants: [
    {
      toolId: "mail.read_message",
      permissionId: "mail-read",
      confirmation: "none",
    },
  ],
  review: {
    summary: "Summarize incoming mail.",
    assumptions: [],
    questions: [],
  },
});
```

## Validation and authority

`actionSpecificationSchema` validates the document shape and cross-references. `validateActionSpecification(unknown)` also returns a review decision with field paths, codes, and explanations:

- `invalid` returns a null specification and validation issues. It cannot be stored as a validated specification.
- `needs_review` returns the validated document and blocking explanations when assumptions, open questions, or a future-event trigger remain. Keep the source and parsed output available for correction.
- `valid` means the structure and declared references are coherent. It does not authorize an operation or activate an action.

Structural diagnostics do not echo submitted values or unsupported field names. Source text and review text are private user content; never send them, document identifiers, or connector identifiers to analytics or general logs. The format has no credential, token, provider endpoint, or trusted authorization fields.

Server consumers must independently authorize the mailbox and exact connected account for the acting user, check connection status and current scopes, and resolve each tool ID against a trusted tool catalog. The catalog must verify that the actual tool effect matches the declared permission; a caller cannot make a sending tool read-only by declaring a read permission. Explicit tool grants, server-side activation consent, and confirmation must remain enforced after edits and at execution time. Instructions and parsed summaries never supply grants. Connector rename or account ordering must not change which `connectionId` is used.

## Local verification

### Reviewed mailbox actions

Each mailbox has one setting, an editable prompt, and immutable reviewed revisions. Reviewing creates a draft revision without changing the currently active revision. Activation binds the exact revision, current setting version, and acting user. Assumptions require acknowledgement; unanswered questions and unsupported triggers block activation. Mailbox owners can configure Gmail actions. Managed-mailbox actions require a current manager grant. Pausing or replacing the active revision prevents queued work from continuing under its old authority.

Connected account mentions store `@[connection:<credential-id>]` independently of their display labels. The private catalog accepts only registered tool effects and exact account bindings. Linear tools are discovered through the existing adapter, then filtered by exact trusted names. Unrecognized tools are unavailable. The reviewed manifest binds the tool effect and input schema digest; activation, execution, and each tool call recheck it. Calendar changes create events without guests or invitations. Background sending and deletion are unavailable. Reply drafts use the existing mailbox compose adapter for normal review and sending.

Calendar actions use the same `@quieter/calendar` contracts and calendar service as the workspace and chat. A reviewed lookup can discover calendars, permissions and time zones for its exact account before selecting a bounded event range or creating an event. Account identity and creation operation IDs are supplied by the server. Confirmed native calendar event links remain available in thread results.

The four additive tables are `mailboxAgentSetting`, `mailboxAgentRevision`, `mailboxAgentRun`, and `mailboxAgentEffect`. Receive work deduplicates by mailbox and message, independently of revision. Gmail enqueues live inbound history messages before advancing its cursor; historical recovery, sent mail, drafts, spam and trash do not enqueue. Managed ingestion awaits enqueue before acknowledging a new or duplicate delivery and keeps its original arrival time. Arrivals before activation are excluded.

The existing maintenance Worker drains runs sequentially with request-owned database clients. Each run checks the activating user's current mailbox access, exact connector ownership, and AI usage balance. Manual runs use the invoking user's accounts. Results are visible only to the acting user. Connected account information cannot be saved into drafts visible to other inbox members. This also applies when a private managed inbox has additional grants.

Actions reuse the user-owned memory context system through `loadAiAgentContext`. When the reviewed capabilities include `memory.read`, a private inbox run selects current context using its actual incoming sender, recipients, subject, message text and saved instructions. This includes relevant reply voice, preferences, relationships and work. The agent can make bounded focused lookups through the same selection path. Context remains evidence subordinate to the saved prompt and permissions; personal facts are never copied into the reviewed specification. Shared inboxes cannot activate a prompt that requires personal context. Runtime checks also prevent loading or using it after the inbox becomes shared. Generated drafts do not create a separate memory-learning path.

Before an external change, the runtime records a pending effect. A lost response, expired lease with an effect, or uncertain provider result stops automatic replay and leaves a visible attention state. Completed drafts and partial summaries remain available. An expired run without effects can retry within its attempt limit. A stable draft local ID aids recovery; it does not establish provider-wide exactly-once delivery. Model steps, run duration, output, and external changes are bounded. Known model usage has durable run receipts and the `mailAction` billing kind.

Daily and weekly schedules and future event sources remain saveable for review but cannot activate. The schema does not imply that those triggers are running.

### Development walkthrough

Start the normal app and local Worker with development-stage secrets and an allowed development database. Enable `QUIETER_GMAIL_AI_AUTOMATION_ENABLED` only when using budget-limited development model credentials. Keep the normal local provider-write and Gmail watch-ownership protections enabled.

Open a mailbox's Actions settings, enter a prompt, review its interpretation, acknowledge any assumptions, and activate it. For a provider-free walkthrough, use a private managed-mail fixture and ingest fresh synthetic mail after activation. Then drain only action work:

```bash
vp run dev:trigger actions
```

This local endpoint drains one run. Open the message thread to see its summary and any prepared draft. Live updates refresh the affected mailbox and thread; polling continues only while a known run is pending. A manual thread run uses the same execution and effect boundary. Gmail and connector write checks still require the existing dedicated account or ownership handoff and account allowlists. No production migration or deployment is part of this walkthrough.

### Contract tests

Run the contract's Node test suite with the existing workspace dependencies:

```powershell
vp test packages/ai/tests/action-specification.test.ts
```

The suite verifies JSON round trips, strict version and field validation, reference integrity, conflicting grants, confirmation safeguards, review states, and schedule validation. It requires no local server, provider write, secret, or database setup.
