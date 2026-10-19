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

Install `react` and `@react-email/render`, then import `Quieter` from `quieter/react` to pass a React Email component to `send`, template creation/update, or campaign creation/update. React inputs generate a plain-text fallback when `text` is omitted. The core `quieter` entry point supports text, HTML, and visual designs without React.

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

## Templates and campaigns

Organization API keys need explicit `templates:read` / `templates:write`, `audiences:read` / `audiences:write`, and `campaigns:read` / `campaigns:write` / `campaigns:send` permissions for their operations. These grants are independent. Existing transactional keys do not gain management permissions.

Save a React Email component as a reusable template. It appears in the team's Templates library as imported HTML with a source editor and preview. React runs in your project; the API receives rendered HTML and text.

```tsx
const template = await quieter.templates.create({
  name: "Product update",
  subject: "What's new this month",
  idempotencyKey: "product-template-2026-10",
  react: <ProductUpdate />,
});

const draft = await quieter.campaigns.create({
  name: "October update",
  audienceId,
  segmentIds: [newsletterSegmentId],
  from: "Updates <updates@example.com>",
  subject: template.subject,
  content: template.content,
});

const review = await quieter.campaigns.preview({ campaignId: draft.id });
```

Campaign `create` and `update` also accept `react: <ProductUpdate />` directly through `quieter/react`. Multiple segments include their union; an empty segment list includes the whole audience. Drafts do not send until confirmed. Present the saved message, sender, audience, exclusions, eligible count, and cost to the user before invoking:

```ts
await quieter.campaigns.send({
  campaignId: draft.id,
  confirmed: true,
  expectedUpdatedAt: draft.updatedAt,
  previewToken: review.previewToken,
  idempotencyKey: "october-campaign-confirmation",
});
```

Keep the confirmation key and input unchanged when retrying an interrupted request. Changes to content or recipient eligibility require another preview. Later template changes do not modify existing drafts or queued messages. Use `campaigns.get`, `list`, `cancel`, and `retry` to manage progress; uncertain provider acceptance is never automatically resent.

Templates support `list`, `get`, `create`, `update`, `duplicate`, `archive`, and `render`. Updates and archive/restore require `expectedUpdatedAt`. `archive({ archived: false, ... })` restores a template. Create and duplicate require a stable `idempotencyKey`. `templates.render` returns HTML, text, and warnings, plus editable JSON and React Email source for visual designs. Exported React components use the current `react-email` package.

For a core SDK or HTTP client, pass content explicitly:

```ts
content: { kind: "html", html: renderedHtml, text: plainText }
content: { kind: "text", text: "A short update" }
content: { kind: "visual", design }
```

`createEmailDesign`, `renderEmailContent`, `exportEmailDesign`, and `importEmailTheme` are also exported for local workflows. Theme imports accept the documented flat theme or matching typed design tokens and reject unsupported values. Imported HTML must be bounded, static email markup with safe links and images. Arbitrary JSX, scripts, forms, and active CSS are rejected. Imported HTML stays source-editable; visual designs round-trip through their versioned JSON.
