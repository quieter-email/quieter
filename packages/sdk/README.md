# quieter

TypeScript SDK for the Quieter send API.

## Durable submissions, limited rollout

`submit` uses the versioned asynchronous API. This endpoint remains disabled until its complete sender and recovery infrastructure passes the controlled rollout checks. Access requires an allowlisted team. Existing `send` and `getMessage` retain their synchronous v1 contracts.

Generate and persist the idempotency key with the intended message before the first request. Use that same message and key after a timeout, lost response, or retryable overload. The SDK performs one HTTP attempt per call and never generates a replacement key during a retry. Render changing React templates once and retain the resulting HTML if retries may cross application releases.

```ts
const idempotencyKey = crypto.randomUUID();
// Persist this key and the message in your job before calling submit.
const message = {
  from: "sender@example.com",
  to: ["reader@example.com"],
  subject: "Hello",
  text: "It works!",
};
const accepted = await quieter.submit(message, { idempotencyKey });
const processing = await quieter.getSubmission(accepted.messageId);
```

Acceptance returns `{ messageId, status: "queued" }`. Repeating an identical request returns that original acceptance; `getSubmission` reports current processing status. `accepted` means the mail provider accepted the send, not that every recipient received it. `pending_confirmation` means the provider outcome is uncertain and must be reconciled; submitting it again with a new key can duplicate delivery. Status includes timestamps and excludes message content. Keys remain retained for at least seven days.

```ts
import { Quieter } from "quieter";

const quieter = new Quieter({
  apiKey: process.env.QUIETER_API_KEY!,
});

const sent = await quieter.send({
  from: "Demo <demo@quieter.email>",
  to: ["to@example.com"],
  subject: "Hello World",
  text: "It works!",
  html: "<strong>It works!</strong>",
});

const delivery = await quieter.getMessage(sent.messageId!);
console.log(delivery.recipients);

const suppressedRecipients = await quieter.listSuppressions();
```

## React Email

Pass a React Email component directly to `send`. Quieter renders it before calling the API.

```tsx
await quieter.send({
  from: "Demo <demo@quieter.email>",
  to: ["to@example.com"],
  subject: "Welcome",
  text: "Welcome, Ada.",
  react: <WelcomeEmail name="Ada" />,
});
```
