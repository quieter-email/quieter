# Small backend cleanup

Additional findings at the original application baseline. Pinned source links support the reported behavior; validation distinguishes local reproductions from source-only traces.

## F102

### P3: Rule-history parsing constructs an argument it never reads

[rules/evaluator.ts:58](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/evaluator.ts#L58), [rules/evaluator.ts:643](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/evaluator.ts#L643).

`parseStoredRuleActionResults` accepts `_context` containing mailbox, message, and rule IDs, but never reads it. Its sole caller constructs the object anyway. This makes the signature suggest context-dependent parsing that does not exist. Remove the parameter and call-site object. This is unused argument plumbing, not a proposal to add identifiers to telemetry or repeat F26.

## F103

### P3: A private division lookup carries an unused database override

[organization/divisions.ts:96](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization/divisions.ts#L96), [organization/divisions.ts:120](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization/divisions.ts#L120).

All three calls to `getDivisionWithManagerAccess` pass only `input`. Its optional `database` parameter is therefore unused as an override. It is also only partially threaded: the division query uses it, but the nested manager check defaults to the global database. Remove the unused parameter from this private helper. If a real transaction caller is later needed, pass its client through both queries. Keep the separately exported manager helper's supported client parameter. No current transaction bug is claimed here.

## F104

### P3: Subscription normalization is followed by impossible checks and a redundant alias

[subscription-sync.ts:91](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/billing/src/subscription-sync.ts#L91), [subscription-sync.ts:105](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/billing/src/subscription-sync.ts#L105), [subscription-sync.ts:119](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/billing/src/subscription-sync.ts#L119).

`userId` is already always a string, so `userId ?? ""` cannot take its fallback. `organizationId` is already a nonempty string or null, so checking both its type and equality to an empty string repeats work the normalization has done. `resolvedOrganizationId` then aliases it without further resolution. Use `userId === ""`, `organizationId === null`, and the validated `organizationId` directly. These checks obscure the actual nullable contract without adding protection.

## F105

### P3: Three files independently spell the same client-or-transaction type

[labels/repository.ts:13](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/labels/repository.ts#L13), [rules/evaluator.ts:37](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/evaluator.ts#L37), [routers/mail-domains.ts:37](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/mail-domains.ts#L37).

Each repeats `DatabaseClient | Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]`, under two different names. The nested extraction is legitimate, but maintaining it at each consumer makes a simple service parameter harder to read and ties each file to the driver's callback shape. Export a type-only `DatabaseTransaction` and client-or-transaction alias from the database boundary, then import them. No new runtime wrapper or repository abstraction is needed.

## F106

### P3: Live-sync token payload validation is copied between issuer and Worker

[gmail-live-sync-token.ts:9](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-live-sync-token.ts#L9), [worker-utils.ts:38](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/cloudflare/src/worker-utils.ts#L38).

The seven-field Zod payload declarations are identical, including timestamp, UUID, and version constraints. One is used by the issuer/verifier and the other by the Worker verifier. They agree today; a future field or version change must be made in both places. Share the payload schema and inferred type through a deployment-safe leaf contract. Keep the runtime-specific signing and verification implementations separate, and do not import the oRPC service graph into the Worker just to reuse the schema. This concerns a copied wire schema, outside the connector duplication investigation.
