# Action specification contract

`@quieter/ai/action-specification` defines the version 1 JSON document for the future Actions editor and runtime. It imports only Zod and can validate documents on the server without an AI credential, database, connector, or background worker. This is the contract foundation for QUIETER-121; connector resolution, review/activation, and execution are tracked in QUIETER-122, QUIETER-123, and QUIETER-124.

The existing custom Actions editor and runtime remain retired. Retained action tables and their graph records remain rollback data. This contract introduces no storage migration, API endpoint, activation mechanism, or execution path.

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

Run the contract's Node test suite with the existing workspace dependencies:

```powershell
vp test packages/ai/tests/action-specification.test.ts
```

The suite verifies JSON round trips, strict version and field validation, reference integrity, conflicting grants, confirmation safeguards, review states, and schedule validation. It requires no local server, provider write, secret, or database setup.
