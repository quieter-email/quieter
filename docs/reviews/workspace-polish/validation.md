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

## Firefox, initial experiment superseded after review

Headed Firefox 155 showed native thin scrollbars during the initial experiment. The user rejected the reserved gutters and extra horizontal clearance. Those captures remain in the gallery as rejected review states. The global scrollbar override, mailbox-picker padding change, and message-list gutter/padding change were fully reverted to baseline `749c409e`. The final Chrome inspection measured `scrollbar-gutter: auto`, `scrollbar-width: auto`, zero list viewport horizontal padding, and the original 4px mailbox-picker padding. Calendar uses the original native scrollbar treatment too. Firefox was not rerun after this exact baseline restoration.

## Database and remaining acceptance

A read-only migration-ledger check verified `quieter_dev` and showed only `20261107111600_boring_magik` pending. The standard guarded `vp run db:migrate` then applied it successfully to development. Production was not changed.

The tracking SQL was also parsed with PostgreSQL 18, and timestamp parameters were checked against the actual column encoder. Existing tracking, delivery, and MIME tests passed. Real send acceptance/recovery, concurrent persisted loads, and public image loading were not exercised against a dedicated Gmail mailbox.

## Review

An independent Astra review found a missing transition out of the new rules view. It was corrected and manually exercised. The review found no other confirmed issue in the tracking authorization/lifecycle, billing action, rolling month anchor, or inline draft contract.

Fix Root Causes led to the editor lifecycle gate. Model the Domain kept tracking scoped to a mailbox and send operation. Type System Discipline kept tool inputs and route views validated. Separate Before Serializing Shared State kept parallel writers in disjoint files. Sequence Work into Verifiable Units grouped checked changes into commits. Prove It Works required interactions in the actual product and native Firefox captures.

Runtime logs remain local because they can contain sensitive operational context. The screenshots contain synthetic data only.

## Spacing review follow-up

The user's composer reference exposed competing 12px header, 16px body, and 10px footer insets, 32px buttons beside 40px fields, and an invisible row border that added a pixel to the gaps. These now use a shared 16px content inset, 8px row gaps, and 40px header controls. The sender, quote toggle, attachments, and drop target follow the same content edge. Paper's composer, reply, shared examples, and field-action reference were updated to match.

Chrome measurements at 390px verified equal 16px label/body/Send/Close insets, 40px fields and buttons, an 8px button gap, a 16px subject-to-body gap, and no page overflow. Expanded fields and a 320px viewport were inspected. The toolbar suppresses its redundant narrow divider and shortcut label before wrapping, so normal mobile widths fit its controls. At 320px, formatting remains horizontally scrollable inside the aligned content area.

The inline forward capture exposed a collapsed writing area when attachments and headers consumed its available height. Compact editors now keep a minimum writing area and grow with their content; the inline frame no longer inherits the main composer's desktop height cap. A forward edited immediately through the actual workspace tool retained its authored text, subject, recipient, and quote. Adding a synthetic local attachment and expanding Cc/Bcc at 390px produced a 245px body, with all body content contained and no page overflow. The final attachment screenshot uses this local sample file; the earlier source-attachment retention check remains separate evidence.

The calendar picker and New event action both measure 224px wide at x=16px. The corresponding six Paper sidebars were aligned, and the open calendar popover was brought in line with the shared title and sizing. Focused lint, formatting, and type checks passed for the changed components.

## Final design and attachment review

The final dialog treatment follows the user's last review of both surface and shape. Dialog, AlertDialog, Drawer, and FullPageDialog use the standard Section shade and foreground, with Detail for nested controls. Their radius uses the existing 20px 4xl token, with 18px inset headers. The visible border is removed. The shared backdrop remains 50% black and uses a light 4px blur. Dark Chrome measured the billing popup at RGB 27/27/30, 20px corners, a transparent border, and a 4px backdrop blur. The actual billing confirmation was opened with browser-only active-plan data and cancelled.

The message-details fixture renders the actual inspector and activity components with two synthetic image loads. Dark, light, 390px, and expanded technical details were inspected. Escape and scrolling worked. Technical headers, original text, source, and payload remain available. Counts describe approximate image loads and do not claim a read receipt or reader identity.

The managed sidebar now has separate Mailboxes and Mail tools navigation regions. Empty automatic rules use a small muted line without a padded card. Populated rules retain their existing card. The organizer was inspected in dark, light, and at 390px. Paper's existing sidebar copies and shared overlay references were updated, and permanent attachment-action, rename, file-drop, and empty-rule examples were added. Paper also includes the existing code radius steps for modal and inset-header corners. Final exports use Paper token hash `149368da`.

Attachment checks used synthetic local files in the actual composer. Upload, rename, menu actions, text preview, and file drop into an inline reply worked. Preview content remained visible after closing the composer. HTML and SVG script payloads did not execute; hostile filenames remained text. The preview has no opener, and its object URL was revoked on close. Forged, expired, cross-mailbox, and reused drag tokens were rejected; a valid same-mailbox token was accepted. Native Chrome PDF embedding failed in this environment, so previews use lazy static PDF.js canvas rendering with bounded page size and page navigation. Both pages of a PDF rendered visible content, and Next and Previous worked. Provider retrieval and sending renamed or dragged attachments were not exercised against an external mailbox. The snippets screenshot uses browser-only empty-list data because the synthetic mailbox has no server-side snippet records.

The final full lint/type pass found one handler-naming error in the new header and four existing warnings. The handler alias was corrected; its focused `vp check --fix` passed with no warnings or errors. Commit hooks checked the final staged source. The merged full suite passed 230 files and 1,989 tests, with 39 files and 453 tests skipped. One sender-boundary test hit its 5s timeout while the production build ran concurrently. Its file then passed all four tests in isolation. The final `vp run @quieter/web#build` passed, including deployment-boundary checks and emission of the lazy PDF renderer and worker assets. No new tests were written.

## Task navigation review

Compose and Labels show one header Close control, aligned with the assistant in a 32px lane. Snippets and Organize mailbox remain sidebar destinations with active rows and no X. Ordinary mail categories and labels have no active state while a task or another destination is open. Selecting a label leaves the task and opens mail.

Manual navigation restored Unread plus a label filter, a selected message/thread, and All inboxes. Direct task links used deterministic fallbacks. After the final destination distinction, Snippets to Compose to Close returned Snippets, and Organize mailbox to Labels to Close returned Organize mailbox with its filter. Composer Close blocked an invalid recipient, saved the corrected synthetic draft, and reopened its subject/body from Drafts. At 320px, the task headers had no page overflow. Desktop Compose controls measured x280 and x1384 at y24, with 32px boxes. Labels used the existing centered content lane. Paper mirrors the task/destination distinction and footer Close relocation.

## Screenshot publishing

The local GitHub CLI was too old for native attachments. A task-local official 2.103.3 release was downloaded and checked against its release digest. Native `gh pr edit --attach` uploaded all 81 screenshots in two batches. The published body was inspected between batches so no successful upload was repeated. Every hosted URL returned HTTP 200 and image content with a normal GET. GitHub's signed image redirects reject HEAD requests, so HEAD was not used as evidence of a broken image. The final tree removes screenshot binaries after verifying their local byte-for-byte backups and hosted links. Earlier commits remain unchanged.

The task preview process tree and task browser sessions were stopped after verification. Other task processes were preserved.
