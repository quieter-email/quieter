# Calendar

Calendar opens as a separate workspace from the mail navigation. **Back to Mail** restores the mail workspace, whose state remains mounted through React `Activity`. Calendar has its own account list, calendar visibility controls, day, week, month, and agenda views, and an event inspector.

## Ownership and package boundaries

`packages/calendar` owns provider-neutral contracts and time calculations. `packages/orpc/src/calendar/google.ts` owns Google API calls, and `service.ts` authorizes each connection against its owner before reading credentials or calendar data. The browser uses `rpc.calendar` through `@quieter/orpc`.

Calendar access belongs to an owned Gmail mailbox and uses that mailbox's encrypted credentials. Each event request includes an account reference and a calendar ID. Sharing a mailbox does not grant access to its owner's calendars.

Existing Calendar account references remain stable. The service matches historical Calendar records to Gmail mailboxes by Google subject and owner, never by email alone. Those records supply identity metadata only. Their old tokens remain untouched for rollback and are no longer used. A historical account without a matching owned Gmail mailbox stays visible with a Connect Gmail action. Selecting another Google account adds that mailbox and leaves the historical account unresolved.

Chat uses the same Calendar service. Calendar writes require approval of the exact input in the persisted assistant exchange. Review uses a fresh destination-calendar read and, for existing events, a fresh event read. Chat still requires an accessible Gmail mailbox, including when opened from Calendar. Direct Calendar actions do not require AI access.

Calendar chat uses the same user-owned [personal context](ai-memory.md) as Mail. Initial recall prioritizes scheduling preferences, work, relationships and activity. It keeps the shared assistant's instruction eligibility, excludes mailbox-specific label rules and ignores a hidden Mail thread's participants. An explicitly attached mail thread remains relevant. The assistant can search further memories and use attendee addresses from live events to recall person-specific context.

Scheduling preferences stated in Calendar chat use the existing chat learning and explicit remember, update and forget workflow. Current availability always comes from live Calendar reads. Calendar event data and direct event edits do not create durable memories or supply instructions; automatic Calendar evidence capture would need its own validated evidence and billing integration.

## OAuth configuration and local runtime

Mail and Calendar use the existing Gmail OAuth client and PKCE flow. Google identity sign-in remains separate and cannot grant either capability. The runtime configuration uses these values:

| Runtime value | SST Secret or purpose |
| --- | --- |
| `GOOGLE_GMAIL_CLIENT_ID` | `GoogleGmailClientId` |
| `GOOGLE_GMAIL_CLIENT_SECRET` | `GoogleGmailClientSecret` |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | `GmailTokenEncryptionKey`, for credentials encrypted at rest |
| `GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT` | Optional current encryption key during rotation |
| `BETTER_AUTH_URL` | Application origin, used to form `/api/gmail/callback` |

The OAuth client's authorized redirect URI must match `${BETTER_AUTH_URL}/api/gmail/callback`. Enable the Calendar API in the Gmail client's Google Cloud project and include `calendar.events` and `calendar.calendarlist` in its consent configuration, alongside the existing Gmail scopes. These Calendar scopes permit event access, discovery of subscribed calendars, and changing the user's calendar colors. They do not grant calendar sharing administration. See [Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth).

Existing Gmail grants without Calendar permission keep working for Mail and show Enable calendar. The user must grant the additional permission in the browser. Refresh preserves stored scopes when Google omits them and cannot invent consent. Reconnect derives the account hint from the owned mailbox and validates the returned Google subject and email. Calendar and invitation returns preserve their location on success, cancellation, and failure.

The former Calendar connector setup and callback are retired. Historical credential rows and deployment secrets are retained for rollback. No schema migration, credential copying, or production backfill is required.

Local execution uses the existing [development setup](development.md) and `vp run dev:sst --stage local-<name>`. Credentials use development SST Secret links or an approved ignored development environment file, read through `@quieter/env`. The database destination remains loopback PostgreSQL or the allowlisted `quieter_dev` database. `vp run env:doctor` validates local configuration after environment changes.

Calendar reads use foreground requests and browser refreshes. No Calendar worker, watch registration, or Pub/Sub subscription is required. Existing preview persona mode supplies sample accounts and events. Preview Calendar edits stay in browser memory and do not call Google or an AI model.

## Local write controls

When `QUIETER_DEPLOYMENT_ENV=local`, every create, update, delete, RSVP, and invitation import passes the same service guard. Local writes require all of these conditions:

- `QUIETER_LOCAL_PROVIDER_MODE` is `write`. The default is `observe`.
- `QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS` contains the connected account's email address. Entries are comma-separated and compared without case sensitivity.
- The connected account has permission to write to the target calendar.
- For every non-primary calendar, the allowlist also contains the target calendar ID, including calendars where the account has manager access. Only the connected account's primary calendar needs no additional target entry.

Calendar's allowlist is independent of the Gmail and Linear write controls. A development OAuth client can still mutate real calendars. Write acceptance requires a dedicated test account or an explicit handoff of ownership for the shared external resource. See [development integration ownership](development-integrations.md).

## Browser cache

Calendar uses the existing IndexedDB-backed TanStack Query persister. Query keys include the signed-in user, connection, calendar, and event or date window. Event-list windows cover whole calendar months in the selected time zone, so different views reuse the same saved data.

| Setting | Current behavior |
| --- | --- |
| Persisted retention | At most 30 days, subject to eviction and browser storage availability |
| Storage budget | Shares the existing 100,000,000-byte budget with mail |
| Query garbage collection | Seven days for inactive Calendar queries |
| Event freshness | Event lists and event details become stale after 60 seconds |
| Account and calendar-list freshness | Five minutes |
| Event-list refresh | Every two minutes while visible, plus stale refreshes on focus and reconnection |

Cached reads remain available offline. Writes still require provider connectivity. Mutation receipts update both persisted and in-memory calendar caches. Recurrence expansion and filtered results refresh when a local patch cannot reproduce the provider result.

Mailbox removal or a connection-wide authorization failure removes that account's cached private data. A calendar-scoped permission failure or missing calendar/event removes only that calendar's cache. Temporary quota failures preserve saved data and surface one retryable notice. Logout and user changes prevent late requests from writing into the next user's cache.

## Event behavior and limits

Timed events store instants and an IANA time zone. All-day events use dates with an exclusive end date. The editor rejects new wall times that are missing or ambiguous during a daylight-saving transition. An unchanged existing timed event preserves its original instants.

Recurring events support changes to one occurrence or the whole series. Whole-series actions load the parent event and its current version first. Changing recurrence or visibility requires the whole series. **This and following** is not supported. Existing custom recurrence rules remain intact unless changed. See [Google recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents).

Calendar API 403 quota responses are classified separately from permission denial, following [Google error handling](https://developers.google.com/workspace/calendar/api/guides/errors).

Updates, deletion, and RSVP check the event's version and send `If-Match`. A conflict requires a refresh and review. Create requests use a stable operation ID and a draft digest to recover a completed request without duplicating the event. Reusing that operation ID with different details fails.

The editor supports guests, availability, visibility, reminders, and meeting links where the target calendar supports them. In day and week views, clicking a time opens a draft, and dragging with a mouse or pen selects a continuous range that snaps to 15 minutes. Touch scrolling and keyboard creation remain available. Provider permissions determine available actions. Locked and special event types remain read-only. Create, update, delete, and RSVP requests ask Google to send guest updates.

Selecting an event opens its editable context panel directly. Changes remain a local draft until Save, with conflict handling against the event's current version. The panel does not hand editing off to Google Calendar. The selected date uses a secondary highlight in the main schedule, separately from today's primary marker. Time-zone choices are searchable and constrained to the available viewport.

Calendar colors use the user's Google calendar-list colors. Event overrides resolve through Google's color palette, with the calendar color as the default. Calendar color changes update the connected user's subscription preference, including for calendars whose events are read-only. Local color writes use the same account and calendar allowlists as other Calendar write tests.

Mail invitation imports let the user choose a writable destination calendar. The server authorizes both the source mailbox attachment and the destination connection. Imports reuse the invitation's `iCalUID` within that calendar to avoid duplicate imports. Importing an invitation does not RSVP to it.

Event-list requests accept windows of up to 93 days and follow provider pagination. Contracts allow up to 200 guests and five custom reminders per event. Calendar settings, calendar creation, and calendar sharing are outside this workspace.

## Provider acceptance status

The preview exercises Calendar UI with sample data. OAuth consent and real Google reads and writes have not been exercised for this change. Rollout must verify Calendar API enablement and the Calendar scopes on the Gmail OAuth client. Dedicated-account acceptance still needs connection and reconnection, token refresh and revocation, shared-calendar permissions, guest notifications, meeting creation, recurrence changes, and invitation import.
