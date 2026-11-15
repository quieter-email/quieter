# Snooze storage contract

Snooze uses one current schedule per mailbox/thread and a separate command journal. The schedule keeps exact hidden message IDs independently of placement receipts. Deleting its creator clears the current actor and placement references but preserves the shared schedule and restore set. Runtime execution must suspend when authority or a required predecessor receipt is missing. Deleting the mailbox removes schedules and journals.

The additive tables constrain lifecycle names, nonnegative versions and attempts, paired lease token/expiry, mailbox/thread uniqueness and actor/mailbox/request/thread command identity. Current grants, reference scope, UUIDs, IANA timezones, JSON arrays and legal transitions remain application boundary responsibilities. A lease expiry does not authorize replay of an uncertain provider effect.

This migration does not implement Snooze, register a timer or change Reminder semantics. Apply through the protected workflow before deploying its consumers. No shared development or production database was changed. Roll back consumers before considering storage removal; preserve accepted command identities and hidden IDs while recovery is possible.

Verification includes schema drift and migration safety checks, complete fresh-chain creation and forward replay on the run-owned disposable PostgreSQL, direct transactional constraint and deletion assertions, scoped type checking and independent source review. Generated snapshots were not hand-edited.
