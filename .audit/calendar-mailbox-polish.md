# Calendar and mailbox polish

Requests received on October 25, 2026. This checklist records the full scope so follow-up requests remain part of the same work.

- [x] Fix calendar loading in the real client-to-server request path.
- [x] Include Calendar permissions and credential refresh in the Gmail mailbox connection.
- [x] Remove Google Calendar as a separate user-facing connector.
- [x] Target the correct Google account during reconnect and preserve the return location.
- [x] Show pending state only for the action that started it.
- [x] Replace repeated calendar refresh failures with one useful notice.
- [x] Keep the existing schedule visible during background refresh where access permits.
- [x] Show loading and recovery for an event opened directly.
- [x] Create timed events by dragging through the continuous day or week grid with 15-minute snapping.
- [x] Preserve click-to-create and keyboard creation.
- [x] Inset events slightly so event and grid borders do not touch.
- [x] Make sidebar navigation destinations real links that support middle-click, modifier-click, and opening in a new tab.
- [x] Keep Compose as an action and remove its misleading middle-click response.
- [x] Highlight the mini-calendar's selected date in the main calendar with a secondary treatment distinct from today.
- [x] Replace the overflowing timezone dropdown with bounded, searchable selection.
- [x] Load Google calendar and event colors correctly and support editing calendar colors.
- [x] Remove the Google Calendar handoff action from event details.
- [x] Display event details in the sidebar and allow direct editing without a separate edit mode or extra edit buttons.
- [x] Find Notion Calendar references in Mobbin and use their useful interaction patterns within Quieter's design system.
- [x] Preserve mailbox ownership, legacy calendar references, consent boundaries, and local write protections.
- [x] Verify, commit, push, and open a reviewable pull request with sample-data screenshots.

Review: [Calendar and mailbox polish, PR #420](https://github.com/quieter-email/quieter/pull/420).

After merging the latest main, `vp check --fix` passed with no errors and two existing warnings. `vp test --maxWorkers 2` passed 181 files and 1,309 tests, with 26 files and 278 tests skipped. Committed migrations and all 284 database integration tests passed on disposable PostgreSQL. Import-boundary and deployment-bundle checks also passed. Real Google consent, reads, and writes remain unverified.

The October 26 review fixed stale pristine event forms, unsupported event color choices, and the missing credential scope column in the unsubscribe test fixture. The audit also fixed draft loss across responsive layouts and confirmation dialogs, refreshed recurring-series data, and normalized revoked mailbox access into immediate Calendar reconnect recovery. Final screenshot review fixed mobile form content painting beneath the action footer. Review replies and runtime verification evidence are recorded in PR #420.

Existing Gmail grants need browser consent for Calendar access. Missing Calendar consent must leave working Mail available. No production deployment or provider write is part of this work.

Browser checks cover forward and reverse drag selection, Escape cancellation, direct event editing and save, selected-day styling, calendar color changes, searchable timezone selection, native sidebar tab opening, and narrow light/dark event panels. Screenshots use sample data in `docs/screenshots/calendar-mailbox-polish/`.

Reference: [Cron Calendar event sheet](https://mobbin.com/screens/f3898403-c903-4b82-baa2-6e9a8f013d05), [Cron time grid](https://mobbin.com/screens/f9963801-2a45-4692-ab42-772b3ffbe220).
