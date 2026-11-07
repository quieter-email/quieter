# Validation

Verified on November 7, 2026, using the isolated local preview and synthetic personas.

## Repository checks

- `vp check --fix` passed with zero errors and four existing React warnings. Commit hooks also checked the final changed source.
- `vp test` passed with 230 files and 1,987 tests. There were 39 skipped files and 453 skipped tests. Windows needed Git Bash first on the process PATH; the initial WSL Bash selection caused six unrelated shell-guard failures.
- The existing workspace-tool and compose-action tests passed again after the editor readiness correction, 22 tests.
- `vp run check:boundaries` passed.
- `vp run check:bundles` passed for AWS and Cloudflare handlers.
- `vp run db:check` passed. The generated migration adds one table and two cascading foreign keys.
- `vp run env:doctor` passed. Development configuration targets the allowlisted `quieter_dev` database.

No new test cases were added. The existing workspace fixture was updated for the expanded bridge interface.

## Product observations

- Assistant navigation from the main composer revealed the selected conversation and unmounted the main composer. Navigation from Organize mailbox also revealed the selected conversation.
- Fresh inline reply initialization followed immediately by an assistant edit retained the authored text, recipient, and quote. The first browser pass found a race; waiting for the actual editor create lifecycle fixed it.
- Inline forwarding retained its source attachment, Fwd subject, quote, and edited recipient. An edit using an outdated revision was rejected.
- Month scrolling crossed November, December, January, and February, then scrolled back. The date window remained bounded. Day and week wheel-handler exercises advanced one day or week while retaining the hour scroll position. Ordinary vertical scrolling retained the date.
- Calendar controls opened in the compact picker. Organizer opened inline with no dialog, and action selection exposed the correct local fields. No rule was saved or backfilled.
- Choosing Calendar and Compose as the startup preference opened those views on a fresh app URL. The router canonicalizes that URL to Inbox, so the resolver accepts the canonical bare Inbox form. Mailbox-scoped and other specific links retained their destinations.
- A browser-only memory fixture loaded a second cursor page automatically, growing from 20 to 28 items with no Load more button.
- An active-plan browser fixture opened the confirmation and cancelled it. No billing operation ran.
- The actual Full details and Activity components rendered synthetic image-load records. This verifies presentation, not provider delivery or persistence.
- Main-view assistant launchers were inspected in Compose, Labels, Snippets, Calendar, and Organize mailbox. No mail-sidebar assistant launcher remained.
- Light and dark surfaces and narrow composer/organizer layouts were inspected.

## Firefox

Headed Firefox 155 showed native thin scrollbars. Its inbox and mailbox picker used `stable both-edges`, with equal clearance on each side. Headless Firefox hid native scrollbars, so the final screenshots use headed Firefox without changing application CSS. Mailbox overflow uses repeated synthetic rows in browser memory.

## Database and remaining acceptance

A read-only migration-ledger check verified `quieter_dev` and showed only `20261107111600_boring_magik` pending. The standard guarded `vp run db:migrate` then applied it successfully to development. Production was not changed.

The tracking SQL was also parsed with PostgreSQL 18, and timestamp parameters were checked against the actual column encoder. Existing tracking, delivery, and MIME tests passed. Real send acceptance/recovery, concurrent persisted loads, and public image loading were not exercised against a dedicated Gmail mailbox.

## Review

An independent Astra review found a missing transition out of the new rules view. It was corrected and manually exercised. The review found no other confirmed issue in the tracking authorization/lifecycle, billing action, rolling month anchor, or inline draft contract.

Fix Root Causes led to the editor lifecycle gate. Model the Domain kept tracking scoped to a mailbox and send operation. Type System Discipline kept tool inputs and route views validated. Separate Before Serializing Shared State kept parallel writers in disjoint files. Sequence Work into Verifiable Units grouped checked changes into commits. Prove It Works required interactions in the actual product and native Firefox captures.

Runtime logs remain local because they can contain sensitive operational context. The screenshots contain synthetic data only.
