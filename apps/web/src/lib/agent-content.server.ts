import {
  API_COMPATIBILITY_DATE,
  API_VERSION_HEADER,
  MCP_API_PATH,
  MESSAGES_API_PATH,
  OPEN_TRACKING_PATH_PREFIX,
  SEND_API_PATH,
  SUPPRESSIONS_API_PATH,
} from "@quieter/mail/public-api";

// Machine-readable descriptions of the public marketing surface. Copy mirrors
// the landing page and legal documents so agents read the same story humans do.

const siteUrl = "https://quieter.email";

// Bump when public page copy or the machine surfaces change.
const contentLastUpdated = "2026-10-29";

const homeMarkdown = `# Quieter

The full email stack for your every need.

Your Gmail, your team's mailboxes and the mail your product sends, in one place.

## Features

- Connect Gmail: Two-way sync with the mailbox you already use.
- Team mailboxes: support@, billing@ and press@ on your own domain, with roles.
- Sending: Send from verified domains over the API, MCP or SDK.
- AI: Context and drafts inside one mailbox. Optional, and you send them.

## Pricing

- Managed: Managed mail for your team with a shared monthly usage balance. $15/month.
- Pro: Managed mail and AI for every team member with a larger shared balance. $25/month.

Email can do more without asking more from you. Join the waitlist at ${siteUrl}/home.
`;

const privacyMarkdown = `# Privacy Policy

Quieter is an email client. This policy describes how personal data is
processed when using the website, creating an account, connecting mailboxes,
sending or receiving mail, using billing, or enabling AI features.

Controller: Leander Timon Riefel, Cosimaplatz 5, Berlin, Germany,
legal@quieter.email.

Full policy: ${siteUrl}/privacy
`;

const termsMarkdown = `# Terms of Service

By creating a Quieter account, you agree to the Terms of Service and the
Privacy Policy. Quieter provides email client functionality for Gmail and
managed mailboxes, including inbox management, compose, search, team features,
and optional AI-assisted chat and Gmail labeling.

Full terms: ${siteUrl}/terms
`;

const cookiesMarkdown = `# Cookie Policy

Cookies and similar storage operate Quieter, remember preferences, and only
with consent measure product usage. Strictly necessary storage covers
authentication sessions, consent preferences, and preview site access.

Full policy: ${siteUrl}/cookies
`;

const imprintMarkdown = `# Imprint

Service provider: Leander Timon Riefel, Cosimaplatz 5, Berlin, Germany.

Contact: support@quieter.email (support), legal@quieter.email (legal).

Social: https://x.com/leanderriefel, https://github.com/leanderriefel
`;

const markdownByPath = new Map([
  ["/", homeMarkdown],
  ["/home", homeMarkdown],
  [
    "/about",
    `# About

Quieter is an email client built around one idea: email can do more without
asking more from you. It connects to Gmail with two-way sync, gives teams
shared mailboxes on their own domain with roles, sends transactional product
email from verified domains over a REST API with delivery tracking, and offers
optional per-person AI drafts inside one mailbox. Quieter treats mailboxes as
private to their owner unless sharing is explicit, and avoids
attention-grabbing patterns.

Quieter is developed by Leander Timon Riefel in Berlin, Germany and is in
private preview. Waitlist: ${siteUrl}/home

More: ${siteUrl}/about - ${siteUrl}/contact
`,
  ],
  [
    "/contact",
    `# Contact

Support and product questions: support@quieter.email
Legal, privacy, and data protection: legal@quieter.email

Postal address: Leander Timon Riefel, Cosimaplatz 5, Berlin, Germany.
Social: https://x.com/leanderriefel, https://github.com/leanderriefel

More: ${siteUrl}/contact - ${siteUrl}/imprint
`,
  ],
  ["/cookies", cookiesMarkdown],
  ["/imprint", imprintMarkdown],
  ["/privacy", privacyMarkdown],
  ["/terms", termsMarkdown],
]);

export const getAgentMarkdown = (pathname: string) =>
  markdownByPath.get(pathname);

export const buildLlmsTxt = () => `# Quieter

> Quieter is an email client that brings your Gmail, your team's shared
> mailboxes on your own domain, and transactional sending over an API into one
> calm place, with optional AI drafts and context inside a single mailbox.

Quieter connects to the mailbox people already use instead of replacing it.
Shared addresses such as support@, billing@ and press@ live on your own domain
with roles, product email sends from verified domains over an API, and AI
stays opt-in per person.

## When to use Quieter

Use Quieter when someone wants to manage Gmail together with shared team
addresses on their own domain, send transactional product mail from verified
domains through an API with delivery tracking, or draft replies with AI
context inside one mailbox. Do not use Quieter for unsolicited bulk marketing
mail; suppressed recipients and domain verification are enforced.

## Surfaces

- Landing page: ${siteUrl}/home
- REST API: bearer-authenticated team API for sending mail and reading
  delivery state and suppressions. Send ${API_VERSION_HEADER} set to
  ${API_COMPATIBILITY_DATE} on every request. OpenAPI specification:
  ${siteUrl}/openapi.json (base URL ${siteUrl}, endpoints ${SEND_API_PATH},
  ${MESSAGES_API_PATH}/{messageId}, ${SUPPRESSIONS_API_PATH})
- MCP server (transactional sending only): ${siteUrl}${MCP_API_PATH} over
  Streamable HTTP, authenticated with a team API key as
  "Authorization: Bearer YOUR_API_KEY" and ${API_VERSION_HEADER}
  ${API_COMPATIBILITY_DATE}. One tool, \`send_email\`, runs the same
  checks as the REST send endpoint: verified sender domains only, suppressed
  recipients rejected, idempotency keys honored, team usage charged. Example
  client entry: {"mcpServers":{"quieter":{"url":"${siteUrl}${MCP_API_PATH}","headers":{"Authorization":"Bearer YOUR_API_KEY","${API_VERSION_HEADER}":"${API_COMPATIBILITY_DATE}"}}}}.
  Example \`send_email\` arguments: {"from":"you@your-verified-domain.com","to":["customer@example.com"],"subject":"Your receipt","text":"Thanks for your order.","idempotencyKey":"order-1234"}.
  Limits: 25 MB request payload, 60 requests per minute per IP, verified sender
  domains, suppression enforcement. The server cannot read mailboxes, mail
  content, or team settings; delivery status stays on the REST API at
  GET ${MESSAGES_API_PATH}/{messageId}. A broader management and control MCP is not
  part of this endpoint.
- Developer documentation: coming soon; will be linked here once released.
- Sitemap of public pages: ${siteUrl}/sitemap.xml

## API versioning and deprecation policy

Quieter versions this API with a compatibility date. Send ${API_VERSION_HEADER}
set to ${API_COMPATIBILITY_DATE}. The date changes only when a breaking change
replaces the current behavior. Requests without that exact date are rejected.
There is no path prefix and no older date to fall back to. Responses repeat
the date in ${API_VERSION_HEADER}.

Open tracking at ${OPEN_TRACKING_PATH_PREFIX}/{token} is not versioned. Mail
clients that load the tracking pixel cannot send a custom header.

The web application itself requires an account during private preview;
public pages and the machine surfaces above stay available regardless.

## Pricing

- Managed ($15/month): managed mail for your team with a shared monthly usage balance.
- Pro ($25/month): managed mail and AI for every team member with a larger shared balance.

## Contact

Support: support@quieter.email - Legal: legal@quieter.email
About: ${siteUrl}/about - Contact page: ${siteUrl}/contact

## Legal

- Privacy: ${siteUrl}/privacy
- Terms: ${siteUrl}/terms
- Cookies: ${siteUrl}/cookies
- Imprint: ${siteUrl}/imprint
`;

export const buildSitemapXml = () => {
  const publicPaths = [
    "/home",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/cookies",
    "/imprint",
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${publicPaths
  .map(
    (path) =>
      `  <url><loc>${siteUrl}${path}</loc><lastmod>${contentLastUpdated}</lastmod></url>`
  )
  .join("\n")}
</urlset>
`;
};

export const agentNotFoundMarkdown = `404 Not found

This path does not exist on Quieter.

- Machine-readable index: ${siteUrl}/llms.txt
- Public pages: ${siteUrl}/sitemap.xml
- API specification: ${siteUrl}/openapi.json
- Landing page: ${siteUrl}/home
`;
