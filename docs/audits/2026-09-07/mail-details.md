# Mail parsing, search, and SDK details

Additional findings at the original application baseline. Pinned source links support the reported behavior; validation distinguishes local reproductions from source-only traces.

## F92

### P2: Managed-mail invitations expose an action that requires a Gmail mailbox

Locations:

- [message-view.tsx:1168](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/components/message-view.tsx#L1168), attachment collection, and [message-view.tsx:1553](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/components/message-view.tsx#L1553), unconditional attachment component.
- [message-attachments.tsx:207](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/components/message-attachments.tsx#L207), connector query; [message-attachments.tsx:261](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/components/message-attachments.tsx#L261), RPC call; [message-attachments.tsx:312](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/components/message-attachments.tsx#L312), calendar button.
- [connectors.ts:13](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/connectors.ts#L13), route; [service.ts:1155](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/service.ts#L1155), unconditional `runAuthorizedGmailMailbox`.
- [gmail-mailbox-access.ts:285](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-mailbox-access.ts#L285), Gmail provider restriction, and line 291, rejection.

The trace confirms there is no managed-mail provider gate. `MessageView` gathers attachments for every provider and passes only attachments, className, and mailboxId to `MessageAttachments`. The calendar button checks the attachment MIME type or `.ics` extension. Connector state changes its label and whether clicking starts connector OAuth or invokes the import RPC. It never checks the mailbox provider.

With an accessible managed mailbox, an inbound `.ics` attachment, and a connected Calendar account, the user sees “Add to Google Calendar.” The server then looks for an owned Gmail mailbox and rejects with `NOT_FOUND`, “Gmail mailbox not found.” An unconnected user can be sent through Calendar connection setup before encountering the same failure. This is a broken advertised action, not evidence of an authorization bypass.

Simplest complete fix: authorize the selected mailbox and load managed bytes through the existing `getManagedMessageAttachment`, keeping Gmail attachment fetching for Gmail. The existing [mail.ts:532](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/mail.ts#L532) download handler already demonstrates that dispatch. Parse the resulting bytes and keep Calendar authorization independent of mail-provider authorization. An interim Gmail-only UI gate would remove the broken action but leave managed import unsupported.

Verification: static end-to-end call trace. Add a managed inbound invitation scenario with a connected Calendar account and assert that the managed attachment loader supplies the event bytes. Also retain access-denial coverage. No Calendar event was created during this audit.

## F93

### P2: Parsing combined status filters silently keeps only the last one

Locations: [search.ts:58](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/search.ts#L58), repeatable types; [search.ts:317](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/search.ts#L317), replacement by type; [service.ts:517](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/service.ts#L517), Gmail compilation through that parser.

Local reproduction:

```text
is:unread is:archived -> is:archived
is:unread -is:trash   -> -is:trash
```

`is` is not repeatable, and replacement compares only the filter type. Read state and mailbox membership are independent conditions, so the parser broadens these queries by dropping the unread restriction. This affects Gmail requests as well as callers that round-trip structured search state.

Simplest fix: preserve multiple `is` predicates and their negation, deduplicating only equivalent conditions. If the UI wants one read-state selection, enforce that within its read-state control rather than replacing every predicate named `is`.

Verification: reproduced by importing the actual parser and serializer. Check that the two examples retain both constraints after serialization and Gmail compilation.

## F94

### P2: Search normalization changes quoted phrases and Boolean expressions

Locations: [search.ts:243](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/search.ts#L243), token scanning without an enclosing quote state; [search.ts:330](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/search.ts#L330), separation of text from filters; [search.ts:338](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/search.ts#L338), moving filters ahead of text; [service.ts:517](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/service.ts#L517), use on every query.

Local parser/serializer reproductions:

```text
from:a@example.com OR from:b@example.com
  -> from:a@example.com from:b@example.com OR

"hello from:a@example.com world"
  -> from:a@example.com "hello world"
```

The scanner treats an operator-shaped word inside a quoted free-text phrase as a filter. Independently, extracting all filters and emitting them first detaches `OR` from its operands. The Gmail compiler therefore changes valid provider search expressions before submitting them. Gmail documents quotation and Boolean search operators in [its search reference](https://support.google.com/mail/answer/7190?hl=en).

Simplest fix: preserve unsupported expressions verbatim instead of flattening them into the structured filter list. Recognize enclosing quotes when extracting supported tokens. For Gmail, restrict custom rewriting to the supported Quieter-specific terms and leave the other query segments in order. A general-purpose query framework is unnecessary.

Verification: the actual functions produced the output above without network access. Retain both cases as query-preservation checks. This is independent of F93: allowing repeated filters alone does not fix either example.

## F95

### P2: Mojibake repair truncates unrelated Unicode characters

Locations: [message-content.ts:121](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/message-content.ts#L121), conversion of every character to a byte; [message-content.ts:134](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/message-content.ts#L134), whole-string repair; [message-content.ts:214](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/message-content.ts#L214), body decoding.

For valid UTF-8 input `Ã© 漢字`, both `decodePartBody` and `decodeMimeHeaderValue` returned `é "W`. Once one suspicious token is present, the repair converts the entire string into Latin-1 bytes using code-point modulo 256. The score comparison sees fewer mojibake markers and accepts a result that has destroyed the unrelated Chinese text. Other scripts and supplementary characters can be damaged the same way, including text inside HTML attributes.

Simplest fix: skip this repair whenever the complete candidate cannot be represented losslessly in the assumed source encoding. Use fatal UTF-8 decoding for a candidate repair and retain the original on failure. Prefer preserving ambiguous valid text to guessing. This does not require replacing the entire message decoder.

Verification: reproduced against both exported decoding functions with synthetic input. A regression must assert preservation of unrelated Unicode, rather than just a lower mojibake score.

## F96

### P2: Header decoding applies destructive HTML and zero-width cleanup to addresses and subjects

Locations: [message-content.ts:204](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/message-content.ts#L204), character removal; [message-content.ts:210](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/message-content.ts#L210), HTML entity decoding; [service.ts:958](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/service.ts#L958), application to all headers.

Local reproductions:

```text
decodeMimeHeaderValue("a&amp;b@example.com") -> "a&b@example.com"
decodeMimeHeaderValue("&amp;lt;test&amp;gt;") -> "<test>"
decodeMimeHeaderValue("👩‍💻") -> "👩💻"
```

Every Gmail header goes through this function, including `From`, `Reply-To`, and message IDs. Literal entity-shaped text in an address is therefore changed to another address. Removing U+200D also splits legitimate joined emoji, and removing U+200C can change script shaping. Header decoding is being conflated with snippet display cleanup. This issue occurs without triggering F95's repair heuristic.

Simplest fix: preserve decoded header text after MIME decoding and ordinary boundary trimming. Apply HTML entity cleanup only where the input contract actually supplies escaped snippet text. Do not globally strip joiners from subjects or addresses.

Verification: direct exported-function reproductions. Assert identity of an entity-shaped local part and a subject containing a joined emoji through the Gmail header reader.

## F97

### P2: An inline attachment can disappear from both exported attachment lists

Locations: [message-content.ts:442](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/message-content.ts#L442), regular attachment exclusion; [message-content.ts:485](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/message-content.ts#L485), inline attachment inclusion; [service.ts:1119](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/service.ts#L1119), message attachment projection.

A synthetic message with HTML `<p>Hello</p>` and an image part containing filename `logo.png`, attachmentId `att`, `Content-ID: <logo>`, and `Content-Disposition: inline` yields `[]` from both `extractMessageAttachments` and `extractInlineMessageAttachments`.

The ordinary attachment list hides anything marked inline with a Content-ID, but the inline list only includes parts actually referenced by the inline HTML. Unreferenced inline files consequently have no download entry. The same mismatch matters when HTML bytes are external: reference extraction only reads `body.data`, while `resolveMessageContent` hydrates the body separately without updating the payload used by attachment extraction.

Simplest fix: hide a file from the regular attachment list only when it is actually exposed through the inline-image path. For hydrated bodies, classify references using the resolved HTML. Retain a downloadable fallback for unreferenced inline parts.

Verification: both empty lists were reproduced using the real helpers. The external-body variant was traced through [service.ts:1080](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/service.ts#L1080). Gmail's [attachment body contract](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments) permits retrieving part bytes separately by attachmentId.

## F98

### P2: Sender extraction mistakes an email in the display name for the actual sender

Locations: [sender-avatar.ts:61](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/sender-avatar.ts#L61), first regex match; [message-utils.ts:32](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/message-utils.ts#L32), same behavior in the email helper; [message-view.tsx:222](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/components/message-view.tsx#L222), use in the message header.

Reproduced input `"billing@trusted.example" <actual@sender.example>` makes `parseSender` return `email: "billing@trusted.example"` and an empty name. The avatar helper uses the same first-match strategy, so it also chooses the display-name domain. A valid display name containing an email can misidentify the address shown as the sender and select branding for the wrong domain.

Simplest fix: prefer the angle-bracket mailbox address, as the existing `extractMailAddress` already does, before applying a fallback for bare addresses. Preserve the display name separately. For broader address syntax, the repository already depends on an address parser through postal-mime; do not add another homemade parser.

Verification: the UI helper result was reproduced locally. The package avatar extraction was traced by inspection of the identical regex strategy. No avatar requests were issued, and this report makes no claim that the actual delivery sender can be authenticated by an avatar.

## F99

### P2: Recipient validation accepts a valid substring and silently drops another address

Locations: [schema.ts:90](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/compose/schema.ts#L90), extraction; [schema.ts:120](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/compose/schema.ts#L120), validation of only the extracted substring; [send.ts:391](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/send.ts#L391), API validation; [send.ts:459](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/send.ts#L459), envelope extraction.

Both `alice@example.com bob@example.com` and `alice@example.com garbage` pass `composeRecipientFieldSchema`. The extractor returns only `alice@example.com`. The full API send schema also accepts the first example, and `buildSendMimeMessage` returns `to: ["alice@example.com"]`.

A common paste mistake looks accepted but sends to only the first recipient. The remaining input is neither rejected nor represented in the transport envelope. This is an input-validation defect that exists before MIME encoding and requires no injected header.

Simplest fix: validate each complete address-list entry, allowing a valid bare mailbox or a complete display-name/address form. Reject trailing unparsed material. If whitespace-separated pasted addresses are intentionally supported, split and validate all of them instead of accepting the first match.

Verification: reproduced both the compose schema and the actual API schema-to-envelope path locally, without sending mail.

## F100

### P2: Draft save responses return encoded subjects as editable text

Locations: [draft-parser.ts:33](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/compose/draft-parser.ts#L33), raw header reader; [draft-parser.ts:61](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/compose/draft-parser.ts#L61), returned subject; [gmail-compose.ts:76](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-compose.ts#L76), caller; [gmail-compose.ts:97](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-compose.ts#L97), returned subject selection.

Passing a draft whose Subject is `=?UTF-8?B?SGVsbG8gw6k=?=` returns that literal encoded word, rather than `Hello é`. Ordinary Gmail message reads decode headers through `getHeader`; the draft parser reads their raw values. After a save, `saveGmailDraft` prefers the nonempty parsed subject over the original draft subject, so encoded syntax can enter editable state and be saved or sent as literal text. Encoded recipient display names have the same inconsistent read path.

Simplest fix: decode textual MIME headers in the draft parser using the corrected header-decoding behavior from F95-F96. Keep structural draft-anchor fields separate from display-text transformations. Preserve the original value if decoding fails.

Verification: reproduced directly with `parseDraftMessage`. Caller replacement was traced. This is separate from F16 because even a correctly formed encoded word from an independent writer triggers it.

## F101

### P3: SDK base URL silently discards a configured path prefix

Locations: [index.ts:158](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/sdk/src/index.ts#L158), absolute endpoint paths; [index.ts:229](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/sdk/src/index.ts#L229), preservation of base pathname; [index.ts:243](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/sdk/src/index.ts#L243), GET resolution; [index.ts:311](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/sdk/src/index.ts#L311), send resolution.

A `Quieter` client configured with `baseUrl: "https://example.test/proxy/"` sends to `https://example.test/api/v1/send`. The constructor preserves and normalizes the supplied pathname, but each endpoint begins with `/`, which discards it during URL resolution. The same behavior affects message and suppression requests. A consumer deploying the API behind a path-prefix proxy receives a request at the wrong endpoint.

Simplest fix: either use relative endpoint paths so the configured prefix is honored, or explicitly define baseUrl as an origin and reject non-root pathnames. Silent acceptance followed by ignoring the prefix is the defect. No endpoint-builder abstraction is needed.

Verification: reproduced by constructing the real SDK client with an injected fetch that records its URL and returns a synthetic success response. No request left the process. This is separate from F30's missing fields, response guards, and React dependency.
