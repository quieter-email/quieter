# Management SDK and CLI

The management SDK and CLI access the authenticated control API. They are separate from the transactional `quieter` sending SDK. Sending API keys cannot authorize management operations.

The source packages are `@quieter/management-sdk` and `@quieter/management-cli`. Both remain private during foundation acceptance. Build local artifacts with Vite+:

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

const client = createManagementClient({
  origin: "http://127.0.0.1:3000",
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

Origins require HTTPS, except exact loopback hosts for local development. Credentials never follow redirects. Browser mode uses browser session credentials; explicit cookie mode disables ambient browser credentials. Both `execute` and `capabilities` accept an abort signal. The client validates requests and results with the shared control schemas.

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

## Handle errors and mutation contracts

Catch `ManagementError` to handle safe management failures. Sign in again for `UNAUTHORIZED`; restore the selected account for `REAUTHENTICATION_REQUIRED`; refresh selection or grants for `FORBIDDEN` and `NOT_FOUND`. Respect retry metadata for `RATE_LIMITED`. Invalid local input and malformed responses fail before they can become trusted application data. Cancellation does not trigger an automatic retry.

For example, a contract-valid settings mutation includes an explicit organization, exact patch, `approvalId`, and `idempotencyKey`. An example payload shape is:

```json
{
  "organizationId": "team-id",
  "openTrackingEnabled": false,
  "approvalId": "<approval issued after human review of this exact action>",
  "idempotencyKey": "<stable key for this exact request>"
}
```

This is a contract example, not an available mutation workflow. The initial adapter exposes reads. Do not invent an approval ID or retry a mutation under a new identity. A future reviewed mutation adapter must obtain exact human approval, revalidate current grants/policy, and return its durable receipt. Pending or uncertain receipts are not success. The SDK does not approve actions or retry automatically. Approved-mutation runtime acceptance remains open in QUIETER-127 and QUIETER-128.

## Distribution and acceptance

Management packages use their own package versions and the `Quieter-Control-Version` compatibility date from the shared contract. The repository maintainers own management releases and compatibility decisions. The transactional SDK's tags, publishing environment, trusted publisher, and release workflows do not publish these packages.

There is no management publication workflow in this foundation. Keep the packages private until actual live reads and an approved mutation pass against the relevant development adapters, the distribution artifacts are verified, and a separately reviewed protected release path is authorized. A package build, synthetic transport probe, or source review does not establish live login, provider behavior, durable approval, or mutation replay.

See [management control contracts](management-control.md) for scopes, source links, pagination, errors, and execution obligations, and [SDK publishing](sdk-publishing.md) for the separate transactional release process.
