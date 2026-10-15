# Daily Brief

Daily Brief saves a short, ranked edition for one user and one mailbox. It is opt-in. Reading the overview does not generate an edition or enable a schedule. The public landing page keeps its coming-soon status until rollout checks pass.

## Generation and receive processing

The existing MailMaintenance Worker checks for work every minute. One invocation processes at most two settings rows, sequentially, and stops starting new work after 80 seconds. This limits overlapping generation and database connections. It selects the oldest attempted eligible rows first, with never-attempted rows first, so retries do not continually displace other mailboxes. The database stores attempt times and leases, so fairness survives Worker restarts. Scheduled editions and pending urgent updates use the same service and the existing database request scope. No second receive worker, provider watch, or queue is created for Daily Brief.

Gmail history processing and managed-mail ingestion mark urgent work after the existing extraction step. The marker is a database update only. Generation runs later in maintenance, so model latency does not extend mail delivery or Gmail acknowledgment. Marker failures are reported without rejecting delivery.

New urgent items appear separately from the saved edition. They do not reorder its ranked items. Reading, dismissing, or deferring a brief item does not mark mail read, archive mail, send replies, or create external reminders. Generation is quiet. It does not send email, browser notifications, or other alerts.

## Schedule and freshness

The user selects an IANA timezone and a local `HH:mm` time. The service stores the next due instant in UTC; the infrastructure cron itself runs every minute in UTC. The service resolves daylight-saving transitions using the selected timezone. A repeated autumn time runs at its first occurrence. A missing spring time runs at the first valid minute after the gap.

Saving a schedule chooses the next future local occurrence. Choosing a time already passed today schedules tomorrow. If maintenance misses an occurrence, it generates one current edition when processing resumes rather than replaying each missed date. A successful full generation schedules the next future occurrence. Urgent updates preserve the scheduled full-edition time.

The same settings row can attempt generation at most once every 15 minutes, with a hard cap of 12 attempts per UTC day. Attempts include manual refresh, scheduled work, urgent checks, failed claimed attempts, and empty candidate passes. New receive markers stay pending during the cooldown. Failed urgent work is retried through the same pending marker and limits. The saved edition remains available while generation is busy or fails. The overview marks an edition stale after the local date changes or the last generation fails.

## Sources and privacy

Each item cites messages supplied to that generation. The server rejects missing, invented, or reused source identifiers. Opening a citation uses the normal mailbox access checks. Candidates and citations remain scoped to the active mailbox. Settings, editions, and feedback are scoped to both user and mailbox; managed-mail access still requires an explicit grant.

Generation uses `loadAiAgentContext` for existing scoped instructions and memory. Memory is context for relevance, not evidence for a claim about mail. Message text, sender text, preferences, and memory are untrusted model input. The generation task cannot run tools or take external actions.

The current candidate pass is bounded to recent mail. Semantic mail search remains a dependency tracked in QUIETER-102 and is not part of this implementation. Semantic memory retrieval and semantic mail search are separate capabilities. Do not describe this edition as a search of the entire mailbox or a guarantee that every important message was considered.

Mail content, source identifiers, user identifiers, and feedback text must stay out of product analytics and routine logs. Unexpected failures use the existing filtered error reporter. Local Sentry and PostHog capture stay off unless explicitly enabled for a test.

## Runtime bindings and cost controls

MailMaintenance reuses the existing linked database, model, billing, credential-encryption, and Gmail OAuth SST Secret resources. No secret is stored in ordinary Worker environment configuration. Gmail token refresh stays server-side. Daily Brief does not need calendar, task, or identity OAuth credentials.

Generation uses the configured background model and the existing credit authorization and usage reporting. It reads at most 24 inbox thread candidates, supplies at most 1,000 body or snippet characters per candidate, and asks for at most eight generated items with a 2,400-token output cap. Mail fetching and model generation share a 45-second abort signal, with no automatic generation retry. These are request bounds, not a fixed dollar guarantee. A cron batch is bounded independently from the number of enabled mailboxes. Keep development AI credentials separate and budget-limited. Never substitute production credentials when local bindings are missing.

## Local verification

Use the allowlisted `quieter_dev` database and the development SST secret cache. Apply the committed additive migration through the normal development migration workflow after checking the database destination. Then run:

```bash
vp run env:doctor
vp run dev:full
# In another terminal:
vp run dev:trigger health
vp run dev:trigger briefs
# Create source mail for the review flow:
vp run dev:fixtures your-local-login@example.com --brief
```

The authenticated local `POST /__dev/briefs` route processes one due settings row. It is unavailable outside local mode, rejects browser origins, and uses the local Worker token. The CLI allows up to three minutes for the request. Local cron work remains manual. Repeat the command to drain further due work. Stop the preview process tree when verification is finished, preserving other chats' processes.

1. Open a mailbox with representative development mail. Confirm the overview starts disabled and does not make a model request before opt-in.
2. Enable Daily Brief, generate an edition, and check summaries against their citations. Switch mailboxes and users to confirm saved editions and feedback do not cross those boundaries.
3. On an enabled mailbox without a recent generation attempt, schedule the next local minute. Wait past that minute, run the trigger, confirm one edition is saved, then trigger again and check that it does not create a duplicate daily edition. For a mailbox refreshed in step 2, wait for its 15-minute cooldown first.
4. Receive new time-critical mail through the existing receive path, allow the cooldown to expire, then trigger maintenance. Confirm an urgent item appears separately while the saved ranking stays fixed. A duplicate delivery must not duplicate the item.
5. Dismiss, defer, or mark an item unimportant. Reload and confirm the feedback persists. Check that the underlying mail and external services have not changed.
6. Test a missing model binding, insufficient credits, and a disconnected mailbox. Confirm the saved edition stays visible and the app shows a useful failure or freshness state.

Managed-mail fixtures are available through the existing `vp run dev:fixtures` workflow. Real Gmail receive tests need the separate development Pub/Sub subscription. Keep observation mode and production watch ownership for shared mailboxes. Full write tests require the dedicated test mailbox or explicit processing handoff described in [Development](development.md).

## Rollout checks

Start with explicit opt-in accounts. Review source accuracy, importance ranking, false urgency, privacy boundaries, generation failures, billed usage, and schedule delay before widening access. Targets are rollout gates, not claims of measured production performance:

- At least 95% of due editions finish within five minutes of becoming eligible under the supported rollout load. Record cooldown delay separately from queueing and generation delay.
- At least 95% of received urgent candidates finish evaluation within five minutes of cooldown expiry under that load, or within five minutes after ingestion when already eligible.
- Every displayed claim has an accessible source citation. Manual review finds no invented deadlines, commitments, or claims of completed actions.
- Review a representative sample of urgent strips before expanding the cohort. Routine receipts, marketing, and generic warnings should not appear as urgent.
- Verify revoked mailbox access immediately blocks reading, refresh, feedback, and future scheduled generation.
- Track aggregate generation duration, failure count, pending backlog, credit usage, and cost per successful edition without logging private mail or identity fields.

If a target fails, keep the cohort limited and correct the source, schedule, or cost issue before changing public availability.
