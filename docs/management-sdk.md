# Management SDK and CLI

The management SDK and CLI access the authenticated control API. They are separate from the transactional `quieter` sending SDK. Sending API keys cannot authorize management operations.

The source packages are `@quieter/management-sdk` and `@quieter/management-cli`. Both remain private during acceptance. Build local artifacts with Vite+:

```bash
vp run @quieter/management-sdk#build
vp run @quieter/management-cli#build
```

To install the private local artifacts in a separate client project, first create tarballs from this checkout:

```bash
vp pm pack --filter @quieter/management-sdk --out /tmp/quieter-management-sdk.tgz
vp pm pack --filter @quieter/management-cli --out /tmp/quieter-management-cli.tgz
```

In the client project's directory, run `vp add /tmp/quieter-management-sdk.tgz /tmp/quieter-management-cli.tgz`. This installs the built artifacts without publishing them. Run its installed CLI with `vp exec quieter-management`.

## Use the SDK

In the installed client project, create a client with an explicit application origin and authentication mode. Browser session mode uses the existing signed-in application session:

```ts
import { createManagementClient } from "@quieter/management-sdk";

const origin = "http://127.0.0.1:3000";
const client = createManagementClient({
  origin,
  auth: { kind: "browser-session" },
});

await client.capabilities({
  target: {
    kind: "mailbox",
    organizationId: "team-id",
    mailboxId: "mailbox-id",
  },
});

await client.execute({
  operation: "mail.search",
  parameters: {
    organizationId: "team-id",
    mailboxId: "mailbox-id",
    category: "inbox",
  },
});
```

Use a discovered mailbox and organization or owned calendar account. Every operation carries its explicit resource identifiers. Capability discovery reloads current access; it is not a stored grant. User-target discovery deliberately lists the signed-in user's accessible mailbox/account metadata. Content reads require the relevant explicit resource parameters.

Node clients use `auth: { kind: "session-cookie", getCookie }`. The callback receives the configured `origin` and optional abort signal on every request. Obtain a development session cookie from an approved local credential store for that exact origin. The client does not retain a global credential, accept a sending key, or infer authentication from environment variables.

Origins require HTTPS, except exact loopback hosts for local development. Credentials never follow redirects. Browser mode uses browser session credentials; explicit cookie mode disables ambient browser credentials. Every client method accepts an abort signal. The client validates requests and results with the shared control schemas.

Operation types include the agreed contract catalogue. Runtime capability discovery determines which operations an adapter implements. A typed operation does not imply an available endpoint, write permission, approval, or successful execution.

## Use the CLI

The source-checkout examples below run the built binary directly through Vite+. Building a workspace package does not install its binary on the shell path. In an installed client project, replace `vp exec node packages/management-cli/dist/bin.js` with `vp exec quieter-management`.

Sign in to the existing development application using its normal login. Store its session in a private file outside Git, bound to the application's origin:

```json
{
  "origin": "http://127.0.0.1:3000",
  "cookie": "<development session cookie header>"
}
```

Make the file readable only by its owner on systems that support file permissions. Do not put the cookie in command arguments, tracked configuration, terminal output, or a production-to-local environment copy.

Save `{"kind":"user"}` in a target JSON file and run:

```bash
vp exec node packages/management-cli/dist/bin.js capabilities \
  --origin http://127.0.0.1:3000 \
  --session-file /private/development-session.json \
  --input /private/user-target.json
```

Save the explicit mailbox, organization, and thread parameters in a separate input file. Use IDs from the current user's accessible resources:

```json
{
  "organizationId": "team-id",
  "mailboxId": "mailbox-id",
  "threadId": "thread-id"
}
```

```bash
vp exec node packages/management-cli/dist/bin.js execute mail.read_thread \
  --origin http://127.0.0.1:3000 \
  --session-file /private/development-session.json \
  --input /private/thread-input.json
```

Use `--input -` to read request JSON from standard input. `--help` does not require credentials. The CLI rereads the session file for each request and rejects a different configured origin before sending its cookie. Successful results are JSON on standard output. Treat that output as private mail/calendar data. Errors go to standard error with a safe code and message, without response bodies, credentials, or stack traces.

## Prepare and review local settings changes

The local settings workflow supports the organization's `openTrackingEnabled` and `allowPerSendOverride` booleans. Discover an organization target with current owner or admin access before requesting a change. Preparation stores an exact patch and returns a browser review link. It does not approve or apply the change.

Keep the original parameters and returned ID with your task. Omit settings that must remain unchanged. An omitted field differs from an explicit `false`.

```ts
const parameters = {
  organizationId: "team-id",
  idempotencyKey: crypto.randomUUID(),
  openTrackingEnabled: false,
};
const prepared = await client.prepareSettingsUpdate({ parameters });
const reviewUrl = new URL(prepared.reviewPath, origin).href;
```

Present `reviewUrl` to the person using the same signed-in browser session that requested the change. The review page shows the exact organization and patch. Choosing Approve records permission, without applying settings. The SDK has no approval method and does not open a browser.

Inspect the current record with `client.reviewMutation({ id: prepared.id })`. After browser approval, the caller can make a separate, explicit execution request with the original parameters:

```ts
const receipt = await client.execute({
  operation: "organization.settings.update",
  parameters: { ...parameters, approvalId: prepared.id },
});
```

Execution rechecks the current session, organization authority, exact patch, original key and approval. Check the receipt's state before reporting success. Use `client.cancelMutation({ id: prepared.id })` to cancel a pending change. Inspect the returned status because a completed request remains terminal and cancellation does not undo it.

Preparation, review and cancellation return the same discriminated `ManagementMutationReview` type. Preparation replay can return an approved or completed record. The client validates that preparation responses match the requested organization and both optional patch fields, and that review/cancel responses match the requested ID. It does not keep a hidden current change or generate a new request identity during recovery.

### Use lifecycle commands

Save the organization, original key and patch in a private JSON file:

```json
{
  "organizationId": "team-id",
  "idempotencyKey": "retained-key-for-this-exact-change",
  "openTrackingEnabled": false
}
```

```bash
vp exec node packages/management-cli/dist/bin.js prepare-settings-update \
  --origin http://127.0.0.1:3000 \
  --session-file /private/development-session.json \
  --input /private/settings-change.json
```

The result is a review JSON record containing `id`, `status` and `reviewPath`. Resolve that path against the configured origin and open it in the original signed-in browser session. Treat the review link and output as private application data and keep them out of telemetry.

Save only the returned ID as `{ "id": "<returned UUID>" }` in `/private/mutation-id.json`. Review or cancel with the same session file:

```bash
vp exec node packages/management-cli/dist/bin.js review-mutation \
  --origin http://127.0.0.1:3000 \
  --session-file /private/development-session.json \
  --input /private/mutation-id.json

vp exec node packages/management-cli/dist/bin.js cancel-mutation \
  --origin http://127.0.0.1:3000 \
  --session-file /private/development-session.json \
  --input - < /private/mutation-id.json
```

To apply an approved change, put the original organization, key and patch plus the returned ID as `approvalId` in a separate execution JSON file. Invoke `execute organization.settings.update` with that file. Review, cancellation and execution are distinct commands. There is no approve command or confirmed flag. All lifecycle commands support the existing file or stdin input and origin-bound session file.

## Handle errors and recovery

Catch `ManagementError` to handle safe management failures. Sign in again for `UNAUTHORIZED`; restore the selected account for `REAUTHENTICATION_REQUIRED`; refresh selection or grants for `FORBIDDEN` and `NOT_FOUND`. Respect retry metadata for `RATE_LIMITED`. Invalid local input and malformed responses fail before they can become trusted application data. Cancellation does not trigger an automatic retry.

An interrupted request can leave its outcome unknown. The SDK and CLI never retry a mutation automatically. If preparation returned no ID, deliberately repeat preparation with the original key, organization and exact patch. If an ID is known, review that record. After a lost execution response, deliberately repeat the same execution request to recover its stored receipt. Never generate a new key to guess whether the earlier request completed.

A successful replay returns the original result before checking approval expiry and does not reapply settings. Current session and role checks still apply. A replacement session cannot consume an older session's change. A valid review with status `failed` is retrieved application data, distinct from failing to retrieve the record. Browser origin checks do not attest physical human presence.

## Distribution and acceptance

Management packages use their own package versions and the `Quieter-Control-Version` compatibility date from the shared contract. The repository maintainers own management releases and compatibility decisions. The transactional SDK's tags, publishing environment, trusted publisher, and release workflows do not publish these packages.

There is no management publication workflow in this foundation. Keep the packages private until actual live reads and an approved mutation pass against the relevant development adapters, the distribution artifacts are verified, and a separately reviewed protected release path is authorized. Native fixture checks can prove local transaction and replay behavior with synthetic authentication. They do not establish live login, human presence, provider behavior or package-release readiness.

See [management control contracts](management-control.md) for scopes, source links, pagination, errors, and execution obligations, and [SDK publishing](sdk-publishing.md) for the separate transactional release process.
