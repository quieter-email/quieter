# quieter

TypeScript SDK for the Quieter send API.

```ts
import { Quieter } from "quieter";

const quieter = new Quieter({
  apiKey: process.env.QUIETER_API_KEY!,
});

await quieter.send({
  from: "Demo <demo@quieter.email>",
  to: ["to@example.com"],
  subject: "Hello World",
  html: "<strong>It works!</strong>",
});
```

## React Email

Install `@react-email/render`, then pass a React Email component as `react`.

```tsx
await quieter.send({
  from: "Demo <demo@quieter.email>",
  to: ["to@example.com"],
  subject: "Welcome",
  react: <WelcomeEmail name="Ada" />,
});
```

## Email SDK

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { quieter } from "quieter/email-sdk";

const email = createEmailClient({
  adapters: [quieter({ apiKey: process.env.QUIETER_API_KEY! })],
  defaultAdapter: "quieter",
});

await email.send({
  from: "Demo <demo@quieter.email>",
  to: "to@example.com",
  subject: "Hello World",
  html: "<strong>It works!</strong>",
});
```
