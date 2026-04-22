## 1. Product Vision

Quieter is not just an email client. The intended trajectory is:

**Stage 1 — Better Inbox UX**
A Gmail/Outlook client with superior UI and workflow improvements.

**Stage 2 — AI-Assisted Inbox**
AI summarizes emails, suggests replies/actions, and categorizes messages.

**Stage 3 — AI Inbox Operator**
AI actively operates mailboxes: triage, respond, create tasks, notify systems, and run workflows.

The product ultimately becomes something closer to:

**AI-operated inbox infrastructure**

rather than a traditional email client.

---

# 2. The Core Entity: Mailbox

The most important modeling decision is:

**The system revolves around mailboxes, not users.**

A mailbox is an email address being operated through Quieter.

Examples:

- `leander@gmail.com`
- `me@leanderriefel.com`
- `support@company.com`
- `jobs@startup.io`

Mailboxes are the objects that:

- receive emails
- run AI workflows
- trigger integrations
- are operated by humans

Users do not “own the system.”
They **operate mailboxes**.

---

# 3. Mailbox Providers

Mailboxes can originate from multiple providers.

Provider determines **how emails are accessed**, not **who owns them**.

Possible providers:

```
gmail
outlook
quieter_hosted (SES)
imap (future)
```

Examples:

| Mailbox                                       | Provider      |
| --------------------------------------------- | ------------- |
| [leander@gmail.com](mailto:leander@gmail.com) | Gmail         |
| [name@outlook.com](mailto:name@outlook.com)   | Outlook       |
| [support@quieter.io](mailto:support@quieter.io) | Quieter hosted |

Provider affects:

- connection method
- email ingestion
- sending
- rate limits
- sync model

But **provider should not determine ownership or collaboration rules**.

---

# 4. Personal vs Organizational Mailboxes

Mailboxes have two conceptual ownership types.

## Personal mailbox

Owned by a single user.

Examples:

- `leander@gmail.com`
- `me@leander.dev`

Characteristics:

- one canonical owner
- private by default
- optionally shareable
- typically Gmail/Outlook connections

Rule of thumb:

If the person leaves, the mailbox leaves with them.

---

## Organizational mailbox

Owned by an organization.

Examples:

- `support@company.com`
- `jobs@startup.com`
- `billing@company.com`

Characteristics:

- managed by multiple people
- permissions per member
- AI workflows common
- lifecycle independent of employees

Rule of thumb:

If someone leaves the company, the mailbox stays.

---

# 5. Users

A user represents a **person logged into Quieter**.

Users:

- authenticate into Quieter
- connect mailboxes
- operate mailboxes
- belong to organizations

Example:

```
User
Leander
```

Leander might operate:

```
leander@gmail.com
support@quieter.io
jobs@quieter.io
```

But the user **does not equal the mailbox**.

This distinction is crucial.

---

# 6. Organizations

Organizations are **collaboration containers**.

They group:

- members
- shared mailboxes
- domains
- integrations

Example:

```
Organization: Quieter
Members:
- Leander
- Alice
- Bob
```

Mailboxes in this organization:

```
support@quieter.io
jobs@quieter.io
billing@quieter.io
```

Organizations exist to support:

- teams
- startups
- companies
- universities
- projects

---

# 7. Personal Workspaces

Every user should implicitly have a **personal organization/workspace**.

Example:

```
Organization: Leander Personal
```

Contains:

```
leander@gmail.com
me@leander.dev
```

This keeps the system consistent:

Everything always lives inside an organization.

Even if the organization contains only one person.

---

# 8. Mailbox Membership

Access to a mailbox is determined by membership.

Example:

```
support@quieter.io
```

Members:

```
Leander (admin)
Alice (operator)
Bob (viewer)
```

Roles might include:

```
owner
admin
operator
viewer
```

Permissions could include:

- read emails
- send replies
- configure automations
- manage integrations
- configure AI

---

# 9. Gmail and Outlook Connections

Connecting Gmail/Outlook creates a **mailbox connection**, not a user identity.

Example flow:

```
User logs into Quieter
→ Connect Gmail
→ OAuth granted
→ Mailbox created
```

Mailbox:

```
leander@gmail.com
provider: gmail
connected_by_user: Leander
```

By default this mailbox:

```
type: personal
visibility: private
```

But it **can later be shared** if desired.

---

# 10. Gmail Inbox Sharing

A Gmail inbox can technically be shared in Quieter, but:

**it should not be the default.**

Default assumptions:

| Provider       | Default Mode   |
| -------------- | -------------- |
| Gmail          | Personal       |
| Outlook        | Personal       |
| Domain mailbox | Organizational |

Sharing a personal inbox should be an **explicit action**.

Reasons:

- users expect Gmail to be private
- reduces trust concerns
- aligns with mental models

However sharing must remain possible because:

- assistants manage inboxes
- founders share Gmail with teams
- AI may operate a personal inbox

---

# 11. Domains

Domains belong to organizations.

Example:

```
quieter.io
```

Owned by:

```
Organization: Quieter
```

Mailboxes under that domain:

```
support@quieter.io
hello@quieter.io
jobs@quieter.io
```

Domains should **not belong to individual users**.

If a single person owns a domain:

They still operate it through their personal organization.

---

# 12. AI Modes

Each mailbox can run different AI levels.

Three modes were proposed:

### Mode 1 — Inbox

Quieter acts as a better email client.

Features:

- improved UI
- better threading
- faster workflows

---

### Mode 2 — AI Assisted

AI helps but does not act autonomously.

Capabilities:

- email summaries
- suggested replies
- categorization
- action recommendations

---

### Mode 3 — Full AI Operator

AI actively manages the mailbox.

Possible actions:

- respond to emails
- label and archive
- create tickets
- notify systems
- escalate issues

Example workflow:

```
Email arrives
AI reads it
AI decides:

reply
create Linear ticket
send Slack notification
archive
```

This is the long-term differentiator.

---

# 13. Integrations

Mailboxes can connect to external systems.

Examples:

```
Linear
GitHub Issues
Slack
Webhooks
```

Example workflow:

```
support@company.com receives email
AI detects bug report
→ create Linear ticket
→ notify Slack
→ reply to user
```

Integrations attach to **mailboxes**, not organizations.

---

# 14. Architecture Overview

High-level architecture from the diagram:

Infrastructure:

```
Cloudflare R2
Amazon SES
Redis cache
```

External APIs:

```
Gmail API
Outlook API
```

Quieter backend:

```
Quieter API
```

Services:

```
Third-party inbox connector
Quieter inbox engine
Support platform layer
```

UI:

```
Quieter UI
```

The support platform integrates with:

```
Linear
GitHub
Slack
```

---

# 15. Recommended Service Architecture

A clearer internal architecture would look like:

```
Provider Connectors
    Gmail
    Outlook
    SES

        ↓

Mailbox Service

        ↓

Inbox Engine

        ↓

AI Automation Layer

        ↓

Integrations

        ↓

UI
```

Responsibilities:

**Provider connectors**

- sync email
- fetch messages
- send replies

**Mailbox service**

- mailbox ownership
- permissions
- metadata

**Inbox engine**

- message storage
- threads
- search
- indexing

**AI automation**

- classification
- summarization
- workflows

---

# 16. UI Structure

Suggested sidebar layout:

```
Personal
  leander@gmail.com
  me@leander.dev

Teams
  Quieter
    support@quieter.io
    jobs@quieter.io

  University Lab
    contact@lab.edu
```

Users choose a mailbox and operate its inbox.

This avoids confusing “account switching.”

---

# 17. Self-Hosted Deployments

Self-hosting targets institutions like universities.

Example deployment:

```
Quieter UI
Quieter API
```

Connected to:

```
University mail server
```

Mailboxes:

```
admissions@uni.edu
support@uni.edu
professor@uni.edu
```

The same architecture works.

---

# 18. Product Positioning

Existing products fall into categories:

| Product     | Category          |
| ----------- | ----------------- |
| Superhuman  | Fast email client |
| Notion Mail | Workspace email   |
| Zendesk     | Support system    |
| Front       | Shared inbox      |

Quieter aims to combine:

```
Email client
+
Shared inbox
+
Support system
+
AI operator
```

The strongest positioning is:

**AI-operated inbox infrastructure**

rather than just another email client.

---

# 19. Development Strategy

Important sequencing recommendation:

Start with:

```
Gmail OAuth
Outlook OAuth
Personal inbox UX
```

Then add:

```
Shared mailboxes
```

Then:

```
AI assistance
```

Then:

```
AI operators
```

Only later:

```
custom domain hosting
SES
```

Building a full email hosting platform too early creates massive complexity.

---

# 20. Core Product Principle

The most important conceptual rule established in the discussion:

```
provider ≠ ownership ≠ collaboration scope
```

Provider:

```
gmail
outlook
ses
```

Ownership:

```
personal
organization
```

Collaboration:

```
private
delegated
shared
team
```

These must remain separate concepts.

If they get conflated, the system becomes difficult to extend.

---

# 21. Final Conceptual Model

The system ultimately consists of these core entities:

```
User
Organization
Mailbox
MailboxMembership
MailboxConnection
Domain
Integration
AIConfiguration
```

Everything in Quieter revolves around **mailboxes being operated by humans and AI**.

That is the conceptual center of the product.
