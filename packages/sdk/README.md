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
