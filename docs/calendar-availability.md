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
