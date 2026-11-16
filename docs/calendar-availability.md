# Verify calendar availability locally

Run the synthetic calendar fixtures from the repository root.

```bash
vp install --frozen-lockfile
vp test packages/calendar/src/availability.test.ts packages/orpc/tests/calendar-availability.test.ts
```

The fixture needs no provider credentials, development database, consent, or background process. It runs the real calendar service and Google/Microsoft adapters with synthetic account rows and HTTP responses. Tests check ownership, permission loss and repair, overlapping recurring instances, tentative events, partial coverage, and the absence of event writes. The pure calculator tests cover source-zone all-day dates, timezone changes, and daylight saving boundaries.

The authenticated `calendar.availability` operation takes an explicit `calendars` selection, `start` and `end` instants, `timeZone`, and `preferences`. Preferences contain weekday working-hour minute ranges, elapsed duration, gaps before and after the proposed meeting, and a start-time step. The operation bounds its calendar count, date range and result count. It checks unfiltered expanded event instances through the existing provider-neutral calendar service.

A complete result contains bounded candidate intervals. Partial or unavailable coverage contains no candidates and a reason for each unavailable selected calendar. Reconnect an account for `reconnect`, repair consent or calendar access for `permission`, refresh the selection for `not-found`, and retry a smaller range for `unsupported` or `temporary`. Retry the same operation after recovery. No candidate means no fitting interval only when coverage is complete.

Working hours use the requested timezone. All-day events use their source timezone and exclusive end dates. Busy tentative and unanswered invitations block time. Free, cancelled, and self-declined events do not. The calculator skips nonexistent or ambiguous start times at daylight saving transitions. Duration and buffers use elapsed minutes.

This operation proposes times for the current user's explicitly selected calendars. It does not establish invitee availability, hold a slot, create an event, or send an invitation. Recheck current access and availability before a separately authorized event write. Saved preference UI, reply insertion, assistant tool registration and optional booking are separate consumers.

These fixtures verify local application behavior. Live provider consent, provider data, and event writes require separate authorized verification. Use approved development credentials and account isolation for that work.

## Reply proposal adapters

`ComposeMeetingProposal` is an isolated scheduling dialog. Its host supplies the current actor, sender, mailbox, draft identity, reply source/context, and recipients. Its insertion callback receives the captured target and plain text. The composer owner must compare the target with the current reply and insert through the ordinary editor transaction, preserving draft recovery, attachments and send safeguards. A changed target resets the dialog selection. The component uses the shared availability operation and presents the selected timezone and incomplete coverage explanation.

Inserted proposals are retained in an actor/mailbox/draft-scoped TanStack Store during the current app session. `MeetingProposalReview` in Calendar lets the actor choose one agreed slot and review it using the existing calendar event editor. Opening review refreshes current mailbox access before exposing proposal details. Background query refreshes preserve edits. The existing session teardown calls `revokeMeetingProposals(userId)`, which only clears the matching actor and cannot clear a newer actor's proposals. The queue is not persisted across reloads. The inserted reply wording follows ordinary draft recovery.

`calendar.createFromProposal` accepts the exact reviewed event, original availability scope, mailbox and stable operation identity. It rejects incomplete calendar coverage, changed conflicts, past times, unsupported precision, recurrence, duration mismatch and a destination outside the checked scope. It uses the acting user's calendar access even when the mailbox is shared. A separate recheck happens immediately before the existing event creator. This is not a reservation or a guarantee against concurrent external calendar changes. If a response was lost after creation, reconcile the existing calendar before retrying; the fresh check may find that already-created event busy. Keep the same operation identity.

`createSchedulingTools({ userId })` supplies a read-only `list_calendar_availability` assistant adapter. The assistant owner binds the authenticated actor and joins it to the existing tool composition. It cannot write a draft, create an event, send mail or establish invitee availability.

The composer mount, assistant composition and session teardown are joined under their owners' narrow integration handoffs. Mounted local verification uses the real composer and event editor with synthetic authentication and RPC transports. It covers selection-safe insertion with quote, signature and attachment preservation, ordinary fixture send and composer close, separate event review, conflict/retry, permission loss, timezone changes and sender changes. These fixtures do not establish live consent, provider delivery or the separate held-send stack integration. No live mail or invitations are sent.

Run the focused timing and isolation checks with:

```bash
vp test packages/orpc/tests/calendar-proposals.test.ts packages/app/src/features/calendar/domain/meeting-proposals.test.ts
```
