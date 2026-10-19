# Visual email builder

Templates are reusable team emails. The `/templates` library supports visual designs, plain text, and imported HTML. `/templates/new` and `/templates/:templateId` are dedicated editor pages. Campaign creation, content, audience selection, and final review also have dedicated routes. A campaign copies the selected template into its draft; delivery never follows a mutable template.

## Content and export

`@quieter/mail/email-design` defines the bounded version-two design and content union. The existing version-one compose document in `visual-email.ts` remains unchanged. Visual designs contain heading, text, image, button, divider, and spacer blocks, plus a validated theme and preheader. Rendering uses presentation tables, inline styles, and a plain-text alternative. Undo/redo belongs to the editing session; saved versions use optimistic concurrency.

The editor exports HTML, editable JSON, and React Email source. The React export is self-contained TSX that imports components from `react-email`. Install that package in the receiving project and use its `render` utility. JSON imports restore the editable visual design. Arbitrary HTML cannot be reliably reconstructed into visual blocks, so imported HTML remains a source-editing workflow with an isolated preview.

React elements are rendered in the optional `quieter/react` SDK entry. The API never evaluates uploaded JavaScript or JSX. `templates.create/update` and `campaigns.create/update` accept React inputs in that SDK entry, generating text when omitted. Other clients can send `{ "kind": "html", "html": "...", "text": "..." }` as content. Existing text-only campaign requests remain valid.

Imported HTML is parsed with an HTML parser and CSS syntax tree. Validation rejects active markup, unsafe schemes, event attributes, invalid CSS, and excessive size/nesting while preserving accepted source. Email preview frames have no script, form, popup, top-navigation, or same-origin privileges. They remain scrollable with pointer and keyboard input, and links default to a new browsing context that the sandbox blocks. External HTTPS images may load; client previews and warnings do not establish identical rendering in every email application. Real cross-client delivery still needs a deployed development send to dedicated recipients.

## Theme import

Theme import accepts a complete flat object or the same fields wrapped in typed `$type` / `$value` tokens. Colors use opaque six-digit hexadecimal values; typed color tokens may also use opaque sRGB components. Font families are `sans`, `serif`, or `mono`. Unsupported fields, references, units, font families, transparency, or out-of-range numbers fail validation. A failed import leaves the current design intact.

```json
{
  "backgroundColor": "#F3F2EF",
  "canvasColor": "#FFFFFF",
  "textColor": "#262824",
  "mutedColor": "#A8A6A0",
  "primaryColor": "#294D43",
  "primaryTextColor": "#FFFFFF",
  "fontFamily": "sans",
  "width": 600,
  "padding": 40,
  "borderRadius": 12
}
```

A typed color uses `{ "$type": "color", "$value": "#294D43" }`; numeric fields use `number`, and the font field uses `fontFamily`. All theme fields are required. Export the current JSON design to inspect its theme before adapting a team's tokens.

## Access and API

Members can read templates; owners and admins can edit them. Programmatic access requires independent `templates:read` and `templates:write` grants on an organization key. Existing audience, campaign, and transactional grants do not imply template access. Key rotation preserves the explicit permissions.

The shared control registry exposes `templates.list`, `get`, `create`, `update`, `duplicate`, `archive`, and `render` over `POST /api/v1/control`, generated OpenAPI, and scope-filtered `/api/v1/control/mcp`. The SDK exposes matching `client.templates` methods. List accepts `search`, `archived`, `limit`, and `offset`. Create/duplicate require an idempotency key; changed input under a used key conflicts. Update/archive require the current `expectedUpdatedAt`. Archive is reversible and never deletes a queued campaign's copied content.

`templates.render` returns `html`, `text`, `warnings`, and nullable `react` and `document`. The latter two are available for visual designs. The core SDK also exports `createEmailDesign`, `renderEmailContent`, `exportEmailDesign`, and `importEmailTheme` for local use. See the [SDK examples](../packages/sdk/README.md#templates-and-campaigns).

## Delivery and rollout

Campaigns store both the source content and rendered HTML/text. Review hashes cover this content and the recipient selection. After confirmation, the existing durable campaign state prevents edits. The worker uses the frozen output and adds the recipient-specific unsubscribe footer to both alternatives, retaining the existing one-click headers, suppression checks, credit reservations, and uncertain-send recovery.

Migration `20261019224137_dapper_shadowcat` adds template and idempotency tables plus nullable campaign content/HTML columns. Legacy campaign rows serialize as plain text. It follows the audience/campaign migrations and is additive. Apply it before deploying the new application and worker through the protected workflow. A prior worker can still deliver old text campaigns, but HTML campaigns require the new worker; deploy the worker before enabling new content creation. Do not roll back the worker while queued HTML campaigns remain.

Local startup uses the existing isolated development setup and allowlisted `quieter_dev` database. The editor, SDK import/export, and dedicated campaign review are testable in the browser. `vp run dev:trigger campaigns` remains a hardcoded dry run; local mode blocks real delivery. No new secrets or services are required. Production migration, deployment, and live delivery verification are separate protected actions. See [Audiences and campaigns](audiences-and-campaigns.md) for processing and recovery.
