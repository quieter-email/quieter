# Workspace polish review

This change covers the sixteen requested mail, calendar, settings, and assistant fixes. The baseline is `749c409e`. Screenshots use the existing synthetic preview personas, without sending mail or changing a subscription.

The editable [Mail](https://app.paper.design/file/01M67920912B7N0WCQ8N924QN0/p-1-0), [Calendar](https://app.paper.design/file/01M67920912B7N0WCQ8N924QN0/p-5-0), and [Settings](https://app.paper.design/file/01M67920912B7N0WCQ8N924QN0/p-3-0) designs were updated in place. Paper includes the shared field/composer examples, inline organizer, plan confirmation, message activity, and attachment states. The cleanup removed 162 superseded or duplicated boards while preserving authentication references, brand artwork, and unrelated product areas. The final review also updated the mail-tool grouping across existing sidebar references and corrected Paper's Popover token to match code.

## Requested changes

| Request | Result | Evidence |
| --- | --- | --- |
| 1. Composer and chat outlines | Removed enclosing focus rings. Fields retain focus fill and individual controls retain keyboard focus. | [Focused composer](https://github.com/user-attachments/assets/33384e44-580a-4ba7-b1c5-6a987363414b), [focused assistant](https://github.com/user-attachments/assets/70c9217e-6553-409c-9937-184cc0a960cc) |
| 2. Composer fields | Rounded, separated recipient and subject fields, larger secondary Cc/Bcc controls, and consistent shared spacing. | [Before](https://github.com/user-attachments/assets/7b368e4a-e4fb-4899-98d4-55d2440bfbaa), [after](https://github.com/user-attachments/assets/87b931fb-0d5d-42e7-b65f-02d4bdd839d7), [narrow](https://github.com/user-attachments/assets/e4c2c411-1dae-4eb1-900c-21cea8be8bfb), [light](https://github.com/user-attachments/assets/f16c7eb4-fe1a-4584-91f9-3cf6ad1955bd) |
| 3. Assistant navigation | Mail navigation leaves Compose, Snippets, Labels, Calendar, and Organize mailbox so the conversation becomes visible. Existing draft preservation remains. | [Runtime observations](validation.md) |
| 4. Inline assistant drafts | Added reply, reply-all, and forward through the existing message-action contract. Immediate edits wait for editor initialization and retain quotes and attachments. | [Inline forward](https://github.com/user-attachments/assets/09cad3fc-d3c3-4181-9bab-21d7e701ef9d) |
| 5. Calendar sidebar | Calendar visibility and account controls live in a popover. Connection choices use a compact account menu. | [Before](https://github.com/user-attachments/assets/6b88b41a-de90-479e-96d5-d97e6efb7f55), [after](https://github.com/user-attachments/assets/8bf8aaac-cd0d-423a-81cd-144dde47a767), [picker](https://github.com/user-attachments/assets/99bfe47e-4636-444f-99fa-2ab7e6168940) |
| 6. Continuous calendar navigation | Month scrolling uses a bounded rolling week window. Day/week accept horizontal or Shift+wheel navigation while preserving vertical hour scrolling. Arrows remain available. | [Month](https://github.com/user-attachments/assets/8bf8aaac-cd0d-423a-81cd-144dde47a767), [runtime observations](validation.md) |
| 7. Connection artwork | Replaced Outlook, OneDrive, ClickUp, and Todoist artwork with official assets. Retained the matching Linear mark. | [Before](https://github.com/user-attachments/assets/5807abd4-05a6-452f-a440-496813cb4f13), [after](https://github.com/user-attachments/assets/9ea59f49-b360-4acb-b879-a7c56dea22f0), [light](https://github.com/user-attachments/assets/ec5949f2-2a30-4769-b246-cade6bad4aae) |
| 8. Connection verbosity | Removed the separate Access section and chat mention instructions. | [Before](https://github.com/user-attachments/assets/1ad2da1a-a4e0-467a-9366-d78d1ccff6bf), [after](https://github.com/user-attachments/assets/8ffb1232-b636-4602-9b8b-59a2b7c591da) |
| 9. Plan changes | Active subscriptions have an explicit Change plan action and confirmation using the existing billing operation and prices. | [Plan fixture](https://github.com/user-attachments/assets/5228eade-890c-4a45-bb67-502aefcb731d), [confirmation](https://github.com/user-attachments/assets/7c3cdd77-27d3-4d3d-ac63-9cd2f1521de2) |
| 10. Memory pagination | The next page loads when its sentinel approaches the viewport. Failed pages retain an explicit retry. | [Automatic loading fixture](https://github.com/user-attachments/assets/147059b2-9cd2-475b-952d-b2d20edde9bc) |
| 11. Gmail open tracking | Gmail sends use the existing signed tracking image and organization setting. Private mailbox records retain approximate image-load activity. | [Activity fixture](https://github.com/user-attachments/assets/7e934ab9-0bd8-4500-9092-0a5238bcf629), [rollout](../../outbound-mail-feedback.md) |
| 12. Settings breadcrumbs | Settings is a nonclickable hierarchy label. Actual parent categories remain links. | [Connection details](https://github.com/user-attachments/assets/8ffb1232-b636-4602-9b8b-59a2b7c591da) |
| 13. Assistant launchers | Removed the sidebar launcher and placed controls in main-view headers. | [Compose](https://github.com/user-attachments/assets/87b931fb-0d5d-42e7-b65f-02d4bdd839d7), [labels](https://github.com/user-attachments/assets/82d13d4e-1f42-44f3-9e56-d8795c0de7dc), [snippets](https://github.com/user-attachments/assets/4d6315d6-bba2-4953-86d8-185d30f3a4fb), [organizer](https://github.com/user-attachments/assets/7e548bfb-faad-4c70-9d38-3e2662047ac7) |
| 14. Startup preference | Added a per-user device Default view preference for mail categories, Calendar, and Compose. It preserves the default mailbox choice. | [Before](https://github.com/user-attachments/assets/51102132-efd7-44cd-9421-b841651ab643), [after](https://github.com/user-attachments/assets/f96073ea-7ce9-4301-aa7e-fede9423aa2e) |
| 15. Scrollbar density | Reverted the scrollbar experiment after review. The message list, mailbox picker, and global scrollbar styling match the original baseline. No reserved side gutters or extra horizontal padding remain. | [Restored inbox](https://github.com/user-attachments/assets/3f2c644f-4741-4b5a-b8bf-1e345c014db5), [restored picker](https://github.com/user-attachments/assets/8c03eecf-2006-43c1-b915-e5121e3b208f), [rejected inbox](https://github.com/user-attachments/assets/d1887548-1637-4b68-a770-03465f8987de), [rejected picker](https://github.com/user-attachments/assets/35df8e20-ac70-42e0-b183-237000146342) |
| 16. Inline organization | Organize mailbox opens an inline rules workspace. Snippets and Organize mailbox sit in a separate Tools group. Empty rules use a small muted line. | [Before](https://github.com/user-attachments/assets/b109363c-52ee-49c0-97c4-ae5f73b3bfb7), [after](https://github.com/user-attachments/assets/7e548bfb-faad-4c70-9d38-3e2662047ac7), [narrow](https://github.com/user-attachments/assets/d7f8cf15-4eee-442b-ab5e-fad8a3e4c8e6), [light](https://github.com/user-attachments/assets/3b543a28-a12a-46ed-ab3e-ff7dddbde870) |

## Before and after

### Composer

| Before | After |
| --- | --- |
| ![Original composer](https://github.com/user-attachments/assets/7b368e4a-e4fb-4899-98d4-55d2440bfbaa) | ![Updated composer](https://github.com/user-attachments/assets/87b931fb-0d5d-42e7-b65f-02d4bdd839d7) |

The To and Subject fields have their own rounded Detail fill. Header fields and Cc/Bcc controls share a 40px height, 14px corners, and 13px type. Labels, body text, attachments, and footer actions share a 16px inset. Field rows and recipient buttons use 8px gaps. The assistant control moved to the main view's upper right.

The spacing review also corrected the inline writing area: it grows with its content, including expanded recipients and attachments. Narrow toolbars keep Send and the attachment actions together; the keyboard shortcut label appears when there is room.

| Spacing review reference | Final geometry |
| --- | --- |
| ![User's composer spacing reference](https://github.com/user-attachments/assets/81780538-d2db-4918-8fdb-fff1d2c607d8) | ![Corrected Paper composer detail](https://github.com/user-attachments/assets/06cf65e4-8df6-4307-9486-0fce524f2883) |
| ![First implementation before spacing refinement](https://github.com/user-attachments/assets/13f218ea-3f10-4e03-ac6a-1e447a3403ff) | ![Final aligned composer](https://github.com/user-attachments/assets/87b931fb-0d5d-42e7-b65f-02d4bdd839d7) |

### Calendar

| Before | After |
| --- | --- |
| ![Original calendar sidebar](https://github.com/user-attachments/assets/6b88b41a-de90-479e-96d5-d97e6efb7f55) | ![Compact calendar sidebar and continuous month](https://github.com/user-attachments/assets/8bf8aaac-cd0d-423a-81cd-144dde47a767) |

![Calendar visibility popover](https://github.com/user-attachments/assets/99bfe47e-4636-444f-99fa-2ab7e6168940)

### Connections

| Before | After |
| --- | --- |
| ![Original connection artwork](https://github.com/user-attachments/assets/5807abd4-05a6-452f-a440-496813cb4f13) | ![Official connection artwork](https://github.com/user-attachments/assets/9ea59f49-b360-4acb-b879-a7c56dea22f0) |
| ![Verbose connection detail](https://github.com/user-attachments/assets/1ad2da1a-a4e0-467a-9366-d78d1ccff6bf) | ![Shorter connection detail](https://github.com/user-attachments/assets/8ffb1232-b636-4602-9b8b-59a2b7c591da) |

Artwork sources are [Microsoft](https://www.microsoft.com/en-us/microsoft-365/onedrive/online-cloud-storage), [ClickUp](https://clickup.com/brand), [Todoist](https://www.todoist.com/press), and [Linear](https://linear.app/brand).

### Preferences

| Before | After |
| --- | --- |
| ![Original preferences](https://github.com/user-attachments/assets/51102132-efd7-44cd-9421-b841651ab643) | ![Default view preference](https://github.com/user-attachments/assets/f96073ea-7ce9-4301-aa7e-fede9423aa2e) |

### Mailbox organization

| Before | After |
| --- | --- |
| ![Original organizer dialog](https://github.com/user-attachments/assets/b109363c-52ee-49c0-97c4-ae5f73b3bfb7) | ![Inline organizer workspace](https://github.com/user-attachments/assets/7e548bfb-faad-4c70-9d38-3e2662047ac7) |
| ![Original sidebar rules icon](https://github.com/user-attachments/assets/39d05cf6-628e-429b-99c7-7393e4ff8235) | ![Named organizer navigation](https://github.com/user-attachments/assets/3f2c644f-4741-4b5a-b8bf-1e345c014db5) |

## New behavior and additional states

Billing and image-load screenshots use browser-only sample query data in the actual product components. The baseline billing account had no active subscription. The active-plan fixture exposes Change plan and its confirmation; the confirmation was cancelled. No checkout, subscription mutation, or real AI request was executed.

The memory fixture started with 20 items. Scrolling loaded eight more through the actual infinite-query observer without a Load more button. The mailbox-picker overflow fixture repeats synthetic rows only in the browser. Earlier Firefox gutter captures remain in the gallery as rejected review states.

### Review refinements

| Before review | Final result |
| --- | --- |
| ![Dialog blending into its background](https://github.com/user-attachments/assets/bb79f2c1-3d38-4c4c-94a1-b701ceb3bf00) | ![Panel surface over a lightly blurred backdrop](https://github.com/user-attachments/assets/7c3cdd77-27d3-4d3d-ac63-9cd2f1521de2) |
| ![Overly rounded attachment dialog](https://github.com/user-attachments/assets/c2b25d3e-7e2d-41f5-a8ff-a81ea1622c6e) | ![Restored shared dialog corners](https://github.com/user-attachments/assets/0977ba34-668c-467f-8e30-621fea855685) |
| ![Prototype message inspector](https://github.com/user-attachments/assets/a843743b-593e-4301-8542-afab800b8dd2) | ![Activity summary and aligned message details](https://github.com/user-attachments/assets/7e934ab9-0bd8-4500-9092-0a5238bcf629) |
| ![Mail tools mixed with folders](https://github.com/user-attachments/assets/4f710260-6fdd-48ba-8fc1-cec4213e8a28) | ![Separate Tools group](https://github.com/user-attachments/assets/3f2c644f-4741-4b5a-b8bf-1e345c014db5) |
| ![Labels retaining the previous inbox selection](https://github.com/user-attachments/assets/9f2bf0b1-f53c-492d-b703-9ad09cbb7e15) | ![Labels task with Close and no selected inbox](https://github.com/user-attachments/assets/82d13d4e-1f42-44f3-9e56-d8795c0de7dc) |

Dialogs, alerts, drawers, and full-page overlays use the original Panel shade and 30px panel rounding with shared superellipse shaping. Inset headers use Section and its 27px radius; nested controls use Detail. The visible border is removed, and a dimmed backdrop with a light 4px blur provides separation. Message details uses a narrower layout, an activity summary, aligned metadata, and a collapsed Technical details section that retains the complete source information.

Composer attachments keep their compact chips. Their menu offers Open in new tab, Rename, and Remove. Files can be dropped into main or inline composers; existing message attachments can be dragged within the same mailbox. Rename preserves the source attachment identity and survives stale save receipts. Preview tabs show images, inert text, and static PDF pages, with a Download action for other formats. They have no opener and remain usable after closing the composer. PDF support loads only when requested.

Snippets and Organize mailbox are destinations with active sidebar rows and no X. Compose and Edit labels are temporary tasks with Close at the top left, opposite the assistant. Mail categories and labels stop showing as selected while those tasks are open. Close restores the previous destination, including its mailbox, filter, message, thread, and All inboxes state. Composer Close keeps its existing validation and draft-saving behavior. Label navigation leaves a task and opens filtered mail.

| State | Screenshot |
| --- | --- |
| Focused composer | ![Focused composer](https://github.com/user-attachments/assets/33384e44-580a-4ba7-b1c5-6a987363414b) |
| Focused assistant with sample plan access | ![Focused assistant](https://github.com/user-attachments/assets/70c9217e-6553-409c-9937-184cc0a960cc) |
| Inline forward with a sample attachment and retained quote | ![Inline assistant forward](https://github.com/user-attachments/assets/09cad3fc-d3c3-4181-9bab-21d7e701ef9d) |
| Expanded inline forward on a narrow screen | ![Expanded inline forward](https://github.com/user-attachments/assets/79ce17ac-e8f5-44ce-81b4-4539a57b1dc6) |
| Active plan fixture | ![Change plan action](https://github.com/user-attachments/assets/5228eade-890c-4a45-bb67-502aefcb731d) |
| Plan confirmation | ![Plan confirmation](https://github.com/user-attachments/assets/7c3cdd77-27d3-4d3d-ac63-9cd2f1521de2) |
| Automatic memory page loading fixture | ![Loaded memory page](https://github.com/user-attachments/assets/147059b2-9cd2-475b-952d-b2d20edde9bc) |
| Message activity fixture | ![Message activity](https://github.com/user-attachments/assets/7e934ab9-0bd8-4500-9092-0a5238bcf629) |
| Light message details | ![Light message details](https://github.com/user-attachments/assets/4760bcb7-0440-4e82-b16f-da4dfa868e3c) |
| Narrow message details | ![Narrow message details](https://github.com/user-attachments/assets/6c6894d4-3c6f-43e8-b67f-1338a9310122) |
| Expanded technical details | ![Technical details](https://github.com/user-attachments/assets/e90bb0ed-f03f-4195-9947-abab68432c9e) |
| Shared dialog surface | ![Dialog](https://github.com/user-attachments/assets/edb128a4-ce70-42e2-b261-1755faa51925) |
| Light shared dialog | ![Light dialog](https://github.com/user-attachments/assets/96d85718-9de3-41c6-bb9a-6971323210cb) |
| Narrow shared dialog | ![Narrow dialog](https://github.com/user-attachments/assets/90758ca8-fe46-489c-8229-eb7f6d8799e9) |
| Restored mailbox picker density | ![Mailbox picker](https://github.com/user-attachments/assets/8c03eecf-2006-43c1-b915-e5121e3b208f) |
| Attachment menu | ![Attachment actions](https://github.com/user-attachments/assets/4279889c-18aa-411b-829c-fb5a3f2ae16b) |
| Rename attachment | ![Rename attachment](https://github.com/user-attachments/assets/0977ba34-668c-467f-8e30-621fea855685) |
| File drop hint | ![Drop files](https://github.com/user-attachments/assets/895f65cb-a557-4090-9682-5aa7ae979a9b) |
| Separate text preview tab | ![Text attachment preview](https://github.com/user-attachments/assets/214ba048-0b0f-444e-b6c1-063907892176) |
| Separate PDF preview tab | ![PDF attachment preview](https://github.com/user-attachments/assets/7f673e93-2b27-4b39-b032-60dd75208f20) |
| Labels header launcher | ![Labels](https://github.com/user-attachments/assets/82d13d4e-1f42-44f3-9e56-d8795c0de7dc) |
| Labels task at 320px in light mode | ![Narrow labels task](https://github.com/user-attachments/assets/4548ce46-d276-4e0b-94a5-ece37843809c) |
| Snippets header launcher, browser-only empty-list fixture | ![Snippets](https://github.com/user-attachments/assets/4d6315d6-bba2-4953-86d8-185d30f3a4fb) |
| Narrow composer | ![Narrow composer](https://github.com/user-attachments/assets/e4c2c411-1dae-4eb1-900c-21cea8be8bfb) |
| Expanded recipient fields at 390px | ![Expanded composer](https://github.com/user-attachments/assets/d6b9a1c3-cb99-469b-a39a-95fd5acc5818) |
| Composer at 320px | ![320px composer](https://github.com/user-attachments/assets/b669937a-2c74-4abf-973e-02886051b6f0) |
| Light composer | ![Light composer](https://github.com/user-attachments/assets/f16c7eb4-fe1a-4584-91f9-3cf6ad1955bd) |
| Narrow organizer | ![Narrow organizer](https://github.com/user-attachments/assets/d7f8cf15-4eee-442b-ab5e-fad8a3e4c8e6) |
| Light organizer | ![Light organizer](https://github.com/user-attachments/assets/3b543a28-a12a-46ed-ab3e-ff7dddbde870) |
| Light connections | ![Light connections](https://github.com/user-attachments/assets/ec5949f2-2a30-4769-b246-cade6bad4aae) |

## Paper exports

| View | Export |
| --- | --- |
| Composer | ![Paper composer](https://github.com/user-attachments/assets/23d403ec-8832-43eb-9438-b08b827aae6c) |
| Composer spacing detail | ![Paper composer detail](https://github.com/user-attachments/assets/06cf65e4-8df6-4307-9486-0fce524f2883) |
| Reply | ![Paper reply](https://github.com/user-attachments/assets/749dda74-fdcb-4625-9e71-15d7371be95f) |
| Shared composer examples | ![Paper composer components](https://github.com/user-attachments/assets/bcbdd0c5-57fe-422c-a5a8-6137e6020166) |
| Shared field actions | ![Paper field actions](https://github.com/user-attachments/assets/d8c62f36-3faa-4b4b-ac67-2e85ebee1b52) |
| Continuous month, full content | ![Paper continuous month](https://github.com/user-attachments/assets/92be036e-25c1-467c-8621-9874cf7e54e5) |
| Calendar visibility popover | ![Paper calendar picker](https://github.com/user-attachments/assets/1c515580-1a0e-49db-8daf-fd73af7f2fb5) |
| Inline organizer | ![Paper organizer](https://github.com/user-attachments/assets/971e8d63-708d-4e19-a9ca-d8baceb4266f) |
| Labels task | ![Paper labels task](https://github.com/user-attachments/assets/5b2924a2-1a3c-4cf1-821a-97345102ec22) |
| Snippets destination | ![Paper snippets destination](https://github.com/user-attachments/assets/27096f37-27f2-4d09-92d7-cc4af154ed0a) |
| Empty organizer | ![Paper empty organizer](https://github.com/user-attachments/assets/4e8e55d9-e348-4ef3-a0e2-1b8cbafb659f) |
| Attachment actions | ![Paper attachment actions](https://github.com/user-attachments/assets/37eefcf8-a731-458f-9c32-934c13449f4b) |
| Rename attachment | ![Paper rename attachment](https://github.com/user-attachments/assets/7e9abd67-5c0d-42c0-9fd9-d418614530ac) |
| File drop | ![Paper file drop](https://github.com/user-attachments/assets/5ed04f90-c80d-43c3-ac75-49e5c9f751da) |
| Shared dialog | ![Paper dialog](https://github.com/user-attachments/assets/74d972a9-033c-4d10-bac4-fe1de9294a47) |
| Shared drawer | ![Paper drawer](https://github.com/user-attachments/assets/eca5f1d3-e6a7-4ba8-9a68-507485f809e9) |
| Shared full-page dialog | ![Paper full-page dialog](https://github.com/user-attachments/assets/d23f08a7-ec4c-4d3f-9bf8-bf78505447b3) |
| Plan confirmation | ![Paper plan confirmation](https://github.com/user-attachments/assets/cc10bd5c-ac1a-42a7-b3ca-30c67f5f50db) |
| Preferences | ![Paper preferences](https://github.com/user-attachments/assets/92ac44c5-0c38-400b-a77a-a94714663114) |
| Connected apps | ![Paper connected apps](https://github.com/user-attachments/assets/671643f1-9e83-4c71-b27e-641d629b8f94) |
| Tracking image activity | ![Paper tracking activity](https://github.com/user-attachments/assets/6ce355d4-9bea-4105-ba75-d46aa0d9ed5b) |

## Verification and rollout

See [validation](validation.md) and the [decision trail](decisions.tsv). The additive `20261107111600_boring_magik` migration was applied to the allowlisted development database only. Production needs that migration before this release deploys. Real Gmail sending, reconciliation, and public tracking-image loads still need a dedicated test mailbox. No production migration or deployment occurred.

The gallery uses native GitHub attachments. This review folder contains no screenshot binaries; earlier commits are preserved. Hosted images were verified with normal GET requests.

## Text-only mail and dialog review

**Text-only mail, compact details, and restored dialog styling**

Text-only messages use the app font at 14px on a transparent background. Unformatted HTML wrappers qualify only when their text matches the plain-text alternative. Sender formatting, fonts, colors, tables, images, direction, and descriptive links keep the existing isolated HTML renderer. Message activity counts and metadata use compact 13px text. Dialogs match the original Panel shade and panel rounding shown in the preferred reference.

| View | Before | After |
| --- | --- | --- |
| Text-only message | ![Text-only mail before](https://github.com/user-attachments/assets/f95c8352-0d2c-4b66-913b-de74bed55010) | ![Text-only mail after](https://github.com/user-attachments/assets/128d1ec5-4346-4bbf-a208-a81c6d893c0f) |
| Rich HTML, unchanged | ![Rich HTML before](https://github.com/user-attachments/assets/4c14707a-83d0-4207-90fc-73573ed3942f) | ![Rich HTML after](https://github.com/user-attachments/assets/9b5c6ecb-491b-488a-beab-b80312c66ac5) |
| Activity typography | ![Activity with oversized count](https://github.com/user-attachments/assets/3231fc02-2b18-4916-bea5-e665043986dd) | ![Compact activity typography](https://github.com/user-attachments/assets/7e934ab9-0bd8-4500-9092-0a5238bcf629) |
| Dialog surface and rounding | ![Previous dialog treatment](https://github.com/user-attachments/assets/e2ab564c-3e4e-4f4d-bbf6-65532d3354ad) | ![Restored dialog treatment](https://github.com/user-attachments/assets/7c3cdd77-27d3-4d3d-ac63-9cd2f1521de2) |

| Additional view | Screenshot |
| --- | --- |
| Text-only message in light mode | ![Text-only mail light](https://github.com/user-attachments/assets/31e0e920-6cd3-49e8-9567-4bcdd071f04c) |
| Text-only message at 390px | ![Text-only mail narrow](https://github.com/user-attachments/assets/c30b1368-ac66-4e4b-b99f-3216f270ecc6) |
| Paper text-only message | ![Paper text-only message](https://github.com/user-attachments/assets/4e1f7091-4c49-4451-b12a-d5ad063e7079) |

Manual browser checks covered 12 text and HTML cases. Rich HTML cases produced identical isolated markup before and after, including sender fonts and colors, tables, images, right-to-left content, and links. Dark, light, and 390px layouts were inspected. Focused lint/type checks and the source commit hook passed. No new tests were written.

## Light theme contrast

**Light themes: selection and text contrast**

Selection now has its own shared fill across sidebar navigation, mail rows, tabs, options, and selected settings rows. Light control shades distinguish idle, hover, and pressed states. Secondary text and small badge labels are darker too, so the stronger fill keeps sender emails, previews, and timestamps readable. The five dark palettes retain their existing colors. Geometry, spacing, and typography are unchanged.

| Theme or view | Before | After |
| --- | --- | --- |
| Light inbox and selected message | ![Light inbox before](https://github.com/user-attachments/assets/d0f0265a-3548-4627-9b8a-1f025fa2b6e5) | ![Light inbox after](https://github.com/user-attachments/assets/88e18938-a4f3-46e6-bdb3-3f37dd3fcd82) |
| Porcelain | ![Porcelain before](https://github.com/user-attachments/assets/509c896f-1b63-4424-be61-84bd5d30295f) | ![Porcelain after](https://github.com/user-attachments/assets/57255430-0368-420e-b598-5e718a4ea4ff) |
| Lilac haze | ![Lilac haze before](https://github.com/user-attachments/assets/e83c2f5e-293c-48ad-8938-e4d46e2f27e7) | ![Lilac haze after](https://github.com/user-attachments/assets/1239eb49-f3b2-4dcf-8e52-aea9bf740425) |
| Sand | ![Sand before](https://github.com/user-attachments/assets/047f300e-8d8a-4434-823e-2770a0dacdaa) | ![Sand after](https://github.com/user-attachments/assets/a330cc59-a98e-4215-bd1a-938afe5836b1) |
| Sage | ![Sage before](https://github.com/user-attachments/assets/98193a43-aedc-497b-b445-d24dd67cd027) | ![Sage after](https://github.com/user-attachments/assets/8fc0ced7-7c8c-4cea-9e32-6a37f3196471) |
| Settings navigation and fields | ![Settings before](https://github.com/user-attachments/assets/ec6bfc24-db26-4e95-a0ce-b3dbd0641c03) | ![Settings after](https://github.com/user-attachments/assets/1de263eb-5588-4256-ab2f-bff356b513cd) |
| Calendar | ![Calendar before](https://github.com/user-attachments/assets/3205ba00-e9e0-49ea-99f4-6f5e4fc1b5b9) | ![Calendar after](https://github.com/user-attachments/assets/9f5afd20-8614-450b-a88b-60ee298877a9) |
| Dark palette comparison | ![Dark before](https://github.com/user-attachments/assets/05637213-9b15-44c3-a6e3-4cb3079c1158) | ![Dark after](https://github.com/user-attachments/assets/dfb2d00d-80c5-4c70-a0bb-0540099d6104) |

| Additional state | Screenshot |
| --- | --- |
| Selected tabs, toggle groups, toolbars, and fields | ![Selection controls](https://github.com/user-attachments/assets/cba5fee5-19f9-4f2f-bce7-9158b75a625e) |
| Menu highlight and text | ![Menu state](https://github.com/user-attachments/assets/fa1cdb1d-1bee-463b-813c-0b953b1e0fc7) |
| Narrow reading view | ![Narrow light reading view](https://github.com/user-attachments/assets/1fc15b38-0b24-4654-977d-3820d229bec9) |
| Paper, all five light themes and selected-message text | ![Paper light themes](https://github.com/user-attachments/assets/ee78cd05-0d8f-4e8e-bcc7-c2817407d58b) |

Manual checks covered the five light themes, selected message metadata, settings, calendar, tabs, toggles, menus, and a 390px reading view. The updated secondary-text colors retain at least 5.4:1 contrast against the shared selection fill in these palettes. All five dark palette comparisons were unchanged. Focused checks and the source commit hook passed. Verification used headless Chromium after the request to keep browser windows hidden.

The settings baseline replays the previous palette in the loaded view so the comparison includes the same content. This gallery supersedes earlier light-theme captures below. [Paper component reference](https://app.paper.design/file/01M67920912B7N0WCQ8N924QN0/p-8-0).
