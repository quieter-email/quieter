# quieter

TypeScript SDK for the Quieter send API.

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

Install `react` and `@react-email/render`, then import `Quieter` from `quieter/react` to pass a React Email component to `send`. The core `quieter` entry point supports text and HTML without React.

```tsx
import { Quieter } from "quieter/react";

const quieter = new Quieter({ apiKey: process.env.QUIETER_API_KEY! });

await quieter.send({
  from: "Demo <demo@quieter.email>",
  to: ["to@example.com"],
  subject: "Welcome",
  text: "Welcome, Ada.",
  react: <WelcomeEmail name="Ada" />,
});
```

Version 0.0.3 moves React input to `quieter/react`. Existing React callers need to change that import. API credentials and the fetch implementation are private, and internal attachment-normalization helpers are no longer exported. `openTracking` is supported by the shared send contract.
