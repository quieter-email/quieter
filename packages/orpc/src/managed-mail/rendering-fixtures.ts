import { Buffer } from "node:buffer";

const bluePng =
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAYAAACLz2ctAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGwSURBVHhe7dIhAQAgAMAwkhCRxHQBTwBuJmauP+baByrjDfCTAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkJQBSRmQlAFJGZCUAUkZkNQFQDFKEUL5YR8AAAAASUVORK5CYII=";
const receiptPng =
  "iVBORw0KGgoAAAANSUhEUgAAALwAAAC2CAYAAABj0ufNAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAQcSURBVHhe7duxEW03EkNBRaIQlex3NxfJh3UNLlB8bFQdZ+x256+///nfv9Ir/ZUH6ZcDXk8FvJ4KeD0V8Hoq4PVUwOupgNdTAa+nAl5PBbyeCng9FfB6KuD1VMDrqYDXUwGvpwJeTwW8nmoG3t5eemgFvE2WHloBb5Olh1bA22TpoRXwNll6aAW8TZYeWgFvk6WHVsDbZOmhFfA2WXpoBbxNlh5aAW+TpYdWwNtk6aEV8DZZemgFvE2WHloBb5Olh1bA22TpoRXwNll6aAW8TZYeWgFvk6WHVsDbZOmhFfA2WXpoBbxNlh5aAW+TpYdWwNtk6aEV8DZZemgFvE2WHloBb5Olh1bA22TpoRXwNll6aAW8TZYeWv0M+D9//uj/2Omlh1bA61Onlx5aAa9PnV56aAW8PnV66aEV8PrU6aWHVsDrU6eXHloBr0+dXnpoBbw+dXrpoRXw+tTppYdWwOtTp5ceWv0MeLtr6aEV8DZZemgFvE2WHloBb5Olh1bA22TpoRXwNll6aAW8TZYeWgFvk6WHVsDbZOmhFfA2WXpoBbxNlh5aAW+TpYdWwNtk6aEV8DZZemgFvE2WHloBb5Olh1bA22TpoRXwNll6aPUz4PMlTWc7vfTQCnh96vTSQyvg9anTSw+tgNenTi89tAJenzq99NAKeH3q9NJDK+D1qdNLD62A16dOLz20Al6fOr300Ap4fer00kOrnwFvdy09tALeJksPrYC3ydJDK+BtsvTQCnibLD20At4mSw+tgLfJ0kMr4G2y9NAKeJssPbQC3iZLD62At8nSQyvgbbL00Ap4myw9tALeJksPrYC3ydJDK+BtsvTQCnibLD20At4mSw+tfgZ8vqT9ercvPbQC/tJuX3poBfyl3b700Ar4S7t96aEV8Jd2+9JDK+Av7falh1bAX9rtSw+tgL+025ceWgF/abcvPbQC/tJuX3po9TPg7a6lh1bA22TpoRXwNll6aAW8TZYeWgFvk6WHVsDbZOmhFfA2WXpoBbxNlh5aAW+TpYdWwNtk6aEV8DZZemgFvE2WHloBb5Olh1bA22TpoRXwNll6aAW8TZYeWgFvk6WHVsDbZOmhFfA2WXpoBbxNlh5aAW+TpYdWwNtk6aEV8DZZemgFvE2WHloBb5Olh1bA22TpoRXwNll6aAW8TZYeWgFvk6WHVsDbZOmhFfA2WXpoBbxNlh5aAW+TpYdWwNtk6aEV8DZZemgFvE2WHloBb5Olh1bA22TpoRXwNll6aAW8TZYeWgFvk6WHVsDbZOmhFfA2WXpoBbxNlh5aAW+TpYdWwNtk6aHVDLy0CHg9FfB6KuD1VMDrqYDXUwGvpwJeTwW8ngp4PRXweirg9VTA66mA11MBr6cCXk8FvJ4KeD0V8Hoq4PVU/wGGhMHNIcQDEQAAAABJRU5ErkJggg==";

const renderingFixtures = [
  {
    html: `<!doctype html>
<html><head><meta charset="utf-8"><title>Spacing fixture</title></head>
<body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#172033">
<h1>Table spacing and card padding</h1>
<table id="fixture-spacing-table" style="border-spacing:16px 24px;background:#cbd5e1"><tbody>
<tr><td style="background:white">First row, first cell</td><td style="background:white">First row, second cell</td></tr>
<tr><td style="background:white">Second row, first cell</td><td style="background:white">Second row, second cell</td></tr>
</tbody></table>
<table id="fixture-padding-card" style="padding:24px;border-radius:12px;background:white"><tbody><tr><td>
<h2>A padded card</h2><p>The card has 24 pixels of padding and rounded corners.</p>
<table id="fixture-action-table" style="border-spacing:0 8px;margin:-8px 0"><tbody>
<tr><td style="background:#dbeafe;padding:12px"><a href="https://example.test/details">View synthetic details</a></td></tr>
<tr><td style="background:#dbeafe;padding:12px"><a href="mailto:support@example.test">Contact the fixture sender</a></td></tr>
</tbody></table></td></tr></tbody></table>
<p><img id="fixture-cid-image" src="cid:fixture-blue" width="40" height="40" alt="Owned blue fixture"></p>
</body></html>`,
    messageKey: "rendering-spacing-v1",
    subject: "Rendering fixture 1 - table spacing and padding",
  },
  {
    html: `<!doctype html>
<html><head><meta charset="utf-8"><title>Image sizing fixture</title></head>
<body style="margin:0;font-family:Arial,sans-serif;color:#172033">
<table id="fixture-width-card" style="width:100%;max-width:516px;background:#eef2f7;padding:24px"><tbody><tr><td>
<img id="fixture-height-logo" src="data:image/png;base64,${bluePng}" height="40" alt="Square logo with only a height">
<h1>Receipt image sizing</h1><p>The square logo has a natural size of 160 by 160 pixels and a height of 40 pixels.</p>
<table id="fixture-receipt-table" width="414" style="width:414px"><tbody><tr>
<td style="width:100%;vertical-align:top"><h2>Synthetic receipt</h2><p>Order EXAMPLE-1042</p><p>Total 24.00</p></td>
<td width="76" style="width:76px;max-width:76px;vertical-align:top"><img id="fixture-receipt-image" src="data:image/png;base64,${receiptPng}" width="94" height="91" alt="Synthetic public receipt graphic"></td>
</tr></tbody></table>
<img id="fixture-receipt-cid-image" src="cid:fixture-receipt" width="94" height="91" alt="The same receipt graphic through an owned CID">
</td></tr></tbody></table>
</body></html>`,
    messageKey: "rendering-images-v1",
    subject: "Rendering fixture 2 - image dimensions and receipt",
  },
  {
    html: `<!doctype html>
<html><head><meta charset="utf-8"><title>Body context fixture</title>
<style>
:root { --fixture-space: 22px; --fixture-ink: #16324f; }
body.fixture-newsletter { margin:0; font-family:Georgia,serif; font-size:18px; line-height:1.6; color:var(--fixture-ink); }
body.fixture-newsletter .fixture-context-card { padding-inline-start:var(--fixture-space); padding-inline-end:10px; margin-block:14px; border-inline-start:4px solid #2563eb; }
body.fixture-newsletter .fixture-context-title { font:inherit; font-weight:bold; margin-block:0 12px; }
</style></head>
<body id="fixture-body-context" class="fixture-newsletter" dir="rtl">
<section id="fixture-context-card" class="fixture-context-card">
<h1 class="fixture-context-title">שלום, הודעת דוגמה</h1>
<p>זוהי הודעה סינתטית לבדיקת כיוון וטיפוגרפיה.</p>
<p lang="en" dir="ltr">The body supplies Georgia, 18 pixels, line height 1.6, and inherited ink. The card uses logical spacing and a root custom property.</p>
<img src="cid:fixture-blue" width="40" height="40" alt="Owned blue fixture">
</section></body></html>`,
    messageKey: "rendering-body-context-v1",
    subject: "Rendering fixture 3 - body context and RTL",
  },
  {
    html: `<!doctype html>
<html><head><meta charset="utf-8"><title>Content policy fixture</title>
<style>
:host { display:none !important; }
.fixture-css-resource { padding-inline-start:18px; background-image:url(https://assets.example.test/rendering-css.png); }
@media (min-width:0px) {
  .fixture-nested-resource { margin-block-start:17px; background-image:image-set("https://assets.example.test/rendering-set.png" 1x); }
}
.fixture-variable-resource { --fixture-image:url(https://assets.example.test/rendering-variable.png); background-image:var(--fixture-image); }
.fixture-fixed-marker { position:fixed; top:0; right:0; width:140px; height:18px; background:#dbeafe; font-size:12px; }
.fixture-style-escape::after { content:"\\3c /style>\\3c p id=fixture-escaped-markup>CSS text only\\3c /p>"; }
.fixture-app-variable { color:var(--primary,#172033); font-family:var(--font-sans,Georgia); }
.fixture-legacy-filter { padding-left:20px; filter:progid:DXImageTransform.Microsoft.Alpha(Opacity=100); color:#16324f; }
</style></head>
<body style="font-family:Arial,sans-serif">
<h1>Links, images, and quotations</h1>
<p><a id="fixture-fragment-link" href="#fixture-link-target">Jump to the section in this message</a></p>
<p id="fixture-link-target">Fragment destination inside this message.</p>
<p><a id="fixture-http-link" href="http://example.test/reference">Public HTTP reference</a></p>
<p><a id="fixture-mailto-link" href="mailto:reader@example.test">Email the synthetic reader</a></p>
<p><img id="fixture-policy-cid-image" src="cid:fixture-blue" width="40" height="40" alt="Owned CID image"></p>
<p><img id="fixture-remote-image" src="https://assets.example.test/rendering-public.png" width="40" height="40" alt="Remote image policy fixture"></p>
<p id="fixture-css-resource" class="fixture-css-resource">CSS background resource policy.</p>
<p id="fixture-nested-resource" class="fixture-nested-resource">Nested CSS image-set resource policy.</p>
<p id="fixture-variable-resource" class="fixture-variable-resource">Custom property resource policy.</p>
<div id="fixture-fixed-marker" class="fixture-fixed-marker">Contained fixed marker</div>
<span id="fixture-style-escape" class="fixture-style-escape"></span>
<p id="fixture-app-variable" class="fixture-app-variable">App custom properties must use this message's fallback.</p>
<p id="fixture-legacy-filter" class="fixture-legacy-filter">A legacy filter must not erase neighboring layout rules.</p>
<blockquote id="fixture-authored-quote"><p>This authored quotation is part of the current message and should remain visible.</p></blockquote>
<div class="gmail_quote" id="fixture-recognized-quote"><p>On a synthetic previous date, a fixture sender wrote:</p><blockquote><p id="fixture-quoted-target">Recognized prior-message quotation.</p></blockquote></div>
<p><a id="fixture-quoted-link" href="#fixture-quoted-target">Jump into the prior-message quotation</a></p>
<script id="fixture-script-marker">window.quieterRenderingFixtureScriptRan = true;</script>
<form id="fixture-active-form" action="https://example.test/disabled-form"><input name="fixture" value="Synthetic content"><button type="submit">Disabled form example</button></form>
</body></html>`,
    messageKey: "rendering-content-policy-v2",
    subject: "Rendering fixture 4 - links, quotes, and content policy",
  },
];

export const buildLocalRenderingFixtures = ({
  address,
  receivedAt,
  suffix,
}: {
  address: string;
  receivedAt: Date;
  suffix: string;
}) =>
  renderingFixtures.map(({ html, messageKey, subject }) => {
    const boundary = `quieter-${messageKey}`;
    const alternativeBoundary = `${boundary}-alternative`;
    const imageParts = [
      { contentId: "fixture-blue", data: bluePng, filename: "blue.png" },
      {
        contentId: "fixture-receipt",
        data: receiptPng,
        filename: "receipt.png",
      },
    ];
    const raw = new TextEncoder().encode(
      [
        "From: Rendering fixture <sender@example.test>",
        `To: ${address}`,
        `Subject: ${subject}`,
        `Message-ID: <${messageKey}.${suffix}@quieter.test>`,
        `Date: ${receivedAt.toUTCString()}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/related; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
        "",
        `--${alternativeBoundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        "",
        `${subject}. Synthetic local email for manual rendering checks.`,
        "",
        `--${alternativeBoundary}`,
        'Content-Type: text/html; charset="utf-8"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(html)
          .toString("base64")
          .match(/.{1,76}/gu)
          ?.join("\r\n"),
        `--${alternativeBoundary}--`,
        ...imageParts.flatMap(({ contentId, data, filename }) => [
          `--${boundary}`,
          `Content-Type: image/png; name="${filename}"`,
          `Content-ID: <${contentId}>`,
          `Content-Disposition: inline; filename="${filename}"`,
          "Content-Transfer-Encoding: base64",
          "",
          data.match(/.{1,76}/gu)?.join("\r\n"),
        ]),
        `--${boundary}--`,
        "",
      ].join("\r\n")
    );
    return { messageKey, raw, subject };
  });
