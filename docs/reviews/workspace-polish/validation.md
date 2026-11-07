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

The local GitHub CLI was too old for native attachments. A task-local official 2.103.3 release was downloaded and checked against its release digest. Native `gh pr edit --attach` uploaded all 81 screenshots in two batches. The published body was inspected between batches so no successful upload was repeated. Every hosted URL returned HTTP 200 and image content with a normal GET. GitHub's signed image redirects reject HEAD requests, so HEAD was not used as evidence of a broken image. This review folder removes its screenshot binaries after verifying their local byte-for-byte backups and hosted links. Earlier commits remain unchanged.

The task preview process tree and task browser sessions were stopped after verification. Other task processes were preserved.

## Final main synchronization

Main's chat activity update was merged while preserving inline-compose activity in its new domain renderer. Manual reply, reply-all, and forward samples classified as completed draft actions.

The later memory/history-search update was also merged cleanly. Focused lint and type checks passed for the overlapping workspace, memory-list, and schema files. `vp run db:check` passed migration graph, schema drift, and safety checks. The installed Drizzle version supports the two commutative snapshot leaves, so no history repair or duplicate migration was needed. A production web build passed again after this merge, including deployment-boundary checks. No newly merged migration was applied by this chat.

## Text-only mail and compact details follow-up

Plain-text bodies now use the app's Geist font, 14px body scale, and a transparent surface. Minimal HTML wrappers use that same path only when their text matches the plain-text alternative. Any sender formatting, document attributes, direction, CSS, tables, images, descriptive links, or differing alternative text retains the existing isolated HTML renderer. Its stylesheet and rendering logic were not changed.

Manual checks used the actual pre-change and current MessageBody components with synthetic local messages. All 12 cases behaved as intended: MIME plain text, paragraphs, line breaks, and literal URLs used the plain path; bold formatting, descriptive links, sender fonts/colors, stylesheets, tables, images, direction, and differing alternatives retained identical HTML markup. The rich HTML comparison screenshots are byte-identical. Plain messages were inspected in dark/light and at 390px. Temporary comparison modules were removed afterward.

The activity count changed from 16px to 13px; section labels and metadata now use the compact 13px scale. The shared dialog title keeps its standard size. Dialog, alert, drawer, and full-page shells restore Panel and the original 30px panel radius with shared superellipse shaping. Inset headers restore Section and its radius. The accepted dimming and light 4px blur remain. Actual billing confirmation, attachment rename, shared dialog, and activity views were inspected. Billing was a browser-only synthetic state; no plan change was submitted.

Focused lint/type checks passed after narrowing DOMPurify's Node result at the rendering boundary. The source commit hook passed for all eight changed files. Type System Discipline informed that boundary guard; the remaining changes reuse the existing type, surface, and radius tokens. No new tests were written or full suite repeated for these scoped follow-ups.

Paper now includes a permanent Text-only message reference alongside the existing HTML message view. Its activity typography, plan confirmation, attachment rename, and shared overlay examples match the restored code tokens. All 21 modal shells were restored; the component references were visually reviewed, and working indicators were cleared. Native hosted attachments replace the outdated current-state captures in the PR and review gallery.

The mail-reading-polish browser was closed. Recorded preview root PID10400 and its child processes were stopped after verification; other task processes were preserved.

## Light theme contrast follow-up

Selection had reused Detail, which nearly matched the light Canvas. The shared selection role now separates navigation, mail rows, tabs, pressed options, current links, and selected settings rows. Inset toolbar selection uses Accent; light Accent follows Selection while dark Accent preserves the former hover shade. Light controls have separate idle, hover, and pressed shades. Secondary text and categorical badge foregrounds were strengthened alongside the fill, including sender addresses, timestamps, and previews.

Manual checks covered Light, Porcelain, Lilac haze, Sand, and Sage in the actual inbox, along with settings, calendar, tabs, toggle groups, toolbars, menus, badges, and a 390px reading view. Selection-to-Canvas contrast ranges from 1.44 to 1.54 across those palettes. Default and secondary foregrounds were measured against Selection separately; secondary contrast ranges from 5.40 to 8.08. These are palette measurements, not a claim about every pixel or state in the product. All five dark palette comparisons retained their previous values, and dark selected surfaces still resolve to the previous shades.

The initial stronger fill retained overly muted secondary text; the final palette darkens those foregrounds too. The settings comparison replays the previous palette in the loaded screen to keep its content consistent. Other before captures were made before editing the palette. Final captures use headless Chromium, with the headless flag verified after the user's preference. Focused checks and both source commit hooks passed. No new tests or full builds were added for these appearance changes.

Paper's Foundations page now contains a permanent Light themes reference for all five palettes, including selected navigation, controls, and a selected message row. It mirrors code colors, uses the existing type and radius scales, and includes the actual navigation SVGs. Small row text, badge fills, alignment, and clipping were checked directly. The existing dark file keeps its colors. Mobbin references informed the selected-state structure: [Skiff](https://mobbin.com/screens/6b1d4162-c493-46b1-9a69-407db25d41c1) and [Superhuman Mail](https://mobbin.com/screens/794d4dae-d263-4883-a6e1-bdcce480ac8c).

The task's light-contrast browser sessions and recorded preview PID84816 were stopped after the first pass. The final inset-toolbar check used its own hidden preview PID91724 and a headless browser; those were stopped after its capture. Unrelated browser and service processes were preserved.
