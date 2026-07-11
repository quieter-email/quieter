# Quieter

Quieter is an experimental email client for Gmail accounts and organization-managed mailboxes. It
combines a focused mail workspace, compose and search tools, mailbox-scoped AI assistance, managed
mail delivery, and privacy controls in one application. Every account starts with a normal team;
there is no separate personal workspace.

> [!WARNING]
> Quieter is deep-alpha software. It is not ready for production users, important mail, or
> self-hosting without substantial operational work.

## Repository Policy

The source is available under the [MIT license](LICENSE), but this is not a community-maintained
project. General feature contributions, support requests, and public bug reports are not accepted.

Security reports are the exception. Report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/quieter-email/quieter/security/advisories/new).
Read [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before contacting the project.

## What Is Here

- A TanStack Start web application with Gmail and managed mailbox workflows
- A typed oRPC API boundary between the application and database
- Better Auth identity, passkey, organization, and API-key integration
- Gmail OAuth, synchronization, drafts, labels, live updates, and mailbox automation
- Managed inbound and outbound email through the SST-owned mail stack, with shared labels,
  structured search, saved views, and automatic organization rules
- Deployment-safe backend module boundaries with CI checks for worker imports and handler bundles
- Mailbox-scoped chat with streamed server-side generation and Gmail tools
- Polar SDK billing integrated with Better Auth
- Browser-only c15t consent preferences and consent-gated analytics

## Technology

| Area                  | Stack                                               |
| --------------------- | --------------------------------------------------- |
| Runtime and workspace | Bun, Vite+                                          |
| Web                   | TanStack Start, TanStack Router, React, Vite, Nitro |
| API and data          | oRPC, TanStack Query, Drizzle, PostgreSQL           |
| Authentication        | Better Auth                                         |
| UI                    | Tailwind CSS 4, `@quieter/ui`, Base UI, Tiptap      |
| Infrastructure        | SST, Cloudflare Workers, AWS mail/background jobs   |
| Quality               | Vite+ (Oxfmt, Oxlint, type-aware checks, Vitest)    |

## Start Here

| Document                                   | Purpose                                                    |
| ------------------------------------------ | ---------------------------------------------------------- |
| [Development](docs/development.md)         | Install, configure, run, test, and change the code locally |
| [Architecture](docs/architecture.md)       | Package boundaries, request flows, and system invariants   |
| [Database safety](docs/database-safety.md) | Local database rules and production role separation        |
| [Deployment](docs/deployment.md)           | CI, production deployment, secrets, and operational checks |
| [Security policy](SECURITY.md)             | Private vulnerability reporting                            |
| [Contribution policy](CONTRIBUTING.md)     | What external changes may be accepted                      |
| [Agent instructions](AGENTS.md)            | Detailed repository constraints for coding agents          |

## Quick Start

Prerequisites:

- [Vite+](https://viteplus.dev/) (`vp`; it provisions the pinned Node runtime and Bun package manager)
- PostgreSQL 16 or newer running locally
- Provider credentials only for the integrations you intend to exercise
- Non-production AWS credentials in `.env.sst.local` only when running the SST development stack

```bash
vp install --frozen-lockfile
cp .env.example .env.local
createdb quieter
vp run db:migrate
vp run dev
```

On PowerShell, use `Copy-Item .env.example .env.local`.

`vp run dev` starts the web app only and deliberately refuses remote database URLs. Developers use
local PostgreSQL, CI uses a temporary PostgreSQL service, and production credentials remain in
protected deployment secrets. See [Development](docs/development.md) for provider setup, the
optional mail-infrastructure session, and alternative commands.

## Common Commands

```bash
vp run dev               # web app only
vp run dev:mail          # optional SST mail/background stack
vp run dev:all           # web app plus optional SST stack
vp run env:doctor        # verify .env.local is isolated from production-shaped keys
vp check                 # format, lint, and type-check
vp run check:copy        # enforce the copy policy
vp test                  # all tests
vp run -r build          # build every workspace package in dependency order
vp run db:generate       # generate a migration after changing schema.ts
vp run db:check          # validate migration history and schema drift
```

Before finishing a change, run:

```bash
vp check --fix
vp run check:copy
vp test
vp run -r build
```

## Status

The codebase changes quickly. The committed schema, migrations, tests, workflows, and package
boundaries are authoritative when documentation and implementation disagree.
