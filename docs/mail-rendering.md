# Mail rendering

HTML mail keeps the sender's document structure, safe styles, dimensions, and colors. The message pane supplies the available reading width and a horizontal scroll surface for wider documents. Mail does not inherit the app's typography, table rules, image rules, theme colors, or custom properties.

`packages/app/src/features/message-thread/domain/mail-html.ts` sanitizes the document with DOMPurify, then applies the same resource policy to HTML attributes and CSS. `mail-css.ts` parses styles with CSS Tree. It removes active constructs, host selectors, external style/font loads, and disallowed resource URLs. It checks declarations inside media and supports groups and custom-property values. Unsupported syntax is removed at the smallest boundary the parser can identify safely. Raw syntax is never serialized. Generated style text escapes closing-style sequences before the document is reparsed.

The sanitized `html`, `head`, and `body` elements are mounted inside a Shadow DOM. Body classes, direction, language, inline styles, and selectors such as `body.newsletter .card` remain effective. A small first stylesheet supplies a light document canvas, fallback typography, focus indicators, and quote-disclosure styling; sender styles follow it. The renderer does not impose table collapse, table widths, image heights, link colors, or contrast corrections.

The app owns the wrapper outside the shadow tree. Layout and paint containment bounds sender-positioned content to the message surface. Horizontal overflow remains reachable. Scripts, forms, frames, top-layer invocation, navigation side effects, and selectors targeting the host are removed before mounting. Ordinary authored blockquotes remain visible. Recognized `.gmail_quote` containers retain their contents and styling inside a disclosure. Message-local fragments move focus within that message and open a containing disclosure.

External-image preferences apply to image sources, responsive image candidates, HTML backgrounds, inline CSS, stylesheets, nested rules, and CSS variables. Safe embedded raster data images and authorized CID images can display while remote images are hidden. The policy does not authorize arbitrary blob URLs from sender markup. CID URLs are replaced only with object URLs created by the mounted renderer from the existing attachment RPC.

The attachment RPC checks mailbox ownership and message/attachment membership. Client cache identity includes the mailbox, message, and attachment. The cache stores files; each mounted body owns and revokes its own object URLs. Only referenced, unambiguous CID entries are requested. Failed images retain their authored space and alternative text. Resource refreshes preserve quote-disclosure and focus state in the same message.

Gmail snippets are decoded once at the provider boundary after MIME-header decoding. This is separate from parsing or rendering HTML bodies. Managed-mail snippets already use their established text extraction path.

To verify the rendering path manually, start the normal local stack, sign in locally, and run:

```bash
vp run dev:fixtures your-local-login@example.com --rendering
```

Use the printed private fixture-mailbox URL. All message bodies and images are synthetic and may be used in review screenshots. The command uses the approved development database and local R2 storage. It does not send mail. Demo mailbox switches must be off for these messages to appear.

| Fixture | Browser checks |
| --- | --- |
| Table spacing and padding | The spacing table uses separate borders and 16 by 24 pixel gaps. The card has 24 pixel padding and rounded corners. Nested action rows have 8 pixel vertical gaps. The owned blue image loads with remote images disabled. |
| Image dimensions and receipt | The outer card keeps its 516 pixel maximum. The height-only logo displays at 40 by 40 pixels. Both receipt graphics display at 94 by 91 pixels. The nested receipt table keeps its 414 pixel width. At a narrow reading width, horizontal overflow stays reachable inside the message. |
| Body context and RTL | Body direction is RTL, typography is Georgia at 18 pixels with a 1.6 line height, and root custom properties supply the card's logical padding and ink. The app's surrounding layout keeps its own direction and typography. |
| Links, quotes, and policy | Authored quotations remain visible; recognized prior-message text is disclosed. Local fragment links focus their destinations without changing the app route. Script/form controls and host selectors disappear. The fixed marker stays inside the message. App variables use the sender's fallbacks. A legacy filter does not erase neighboring CSS. Remote HTML/CSS resources make no requests while images are hidden. |

Inspect both light and dark app themes and a narrow viewport. The mail's authored colors stay stable as the surrounding app changes theme. Check network requests as well as visible images: an absent image alone does not prove a resource was blocked. To verify interaction state during CID resolution, delay the attachment response in the tab's developer tools, open a quote or follow its fragment link, then release the response.

Shadow DOM is not an independent browsing document. Media queries still use the app viewport, and `rem` units use the outer document's root size. The renderer does not yet translate viewport-dependent layouts to reading-pane width. CSS imports, web fonts, keyframes, and at-rules other than media/supports are omitted. Image and image-set expressions using variables are omitted when a substituted string could introduce an unchecked URL. Fixed or excessively tall sender layouts can still be awkward within their contained surface. These limitations should remain explicit when assessing fidelity.
