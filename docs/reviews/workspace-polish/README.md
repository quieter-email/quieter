# Workspace polish review

This change covers the sixteen requested mail, calendar, settings, and assistant fixes. The baseline is `749c409e`. Screenshots use the existing synthetic preview personas, without sending mail or changing a subscription.

The editable [Mail](https://app.paper.design/file/01M67920912B7N0WCQ8N924QN0/p-1-0), [Calendar](https://app.paper.design/file/01M67920912B7N0WCQ8N924QN0/p-5-0), and [Settings](https://app.paper.design/file/01M67920912B7N0WCQ8N924QN0/p-3-0) designs were updated in place. Paper also includes the shared field/composer examples, inline organizer, plan confirmation, and tracking activity. The cleanup removed 162 superseded or duplicated boards while preserving authentication references, brand artwork, and unrelated product areas.

## Requested changes

| Request | Result | Evidence |
| --- | --- | --- |
| 1. Composer and chat outlines | Removed enclosing focus rings. Fields retain focus fill and individual controls retain keyboard focus. | [Focused composer](after/compose-focused.png), [focused assistant](after/assistant-focused.png) |
| 2. Composer fields | Rounded, separated recipient and subject fields, larger secondary Cc/Bcc controls, and consistent shared spacing. | [Before](before/compose.png), [after](after/compose.png), [narrow](after/compose-narrow.png), [light](after/compose-light.png) |
| 3. Assistant navigation | Mail navigation leaves Compose, Snippets, Labels, Calendar, and Organize mailbox so the conversation becomes visible. Existing draft preservation remains. | [Runtime observations](validation.md) |
| 4. Inline assistant drafts | Added reply, reply-all, and forward through the existing message-action contract. Immediate edits wait for editor initialization and retain quotes and attachments. | [Inline forward](after/inline-ai-forward.png) |
| 5. Calendar sidebar | Calendar visibility and account controls live in a popover. Connection choices use a compact account menu. | [Before](before/calendar.png), [after](after/calendar.png), [picker](after/calendar-picker.png) |
| 6. Continuous calendar navigation | Month scrolling uses a bounded rolling week window. Day/week accept horizontal or Shift+wheel navigation while preserving vertical hour scrolling. Arrows remain available. | [Month](after/calendar.png), [runtime observations](validation.md) |
| 7. Connection artwork | Replaced Outlook, OneDrive, ClickUp, and Todoist artwork with official assets. Retained the matching Linear mark. | [Before](before/connections.png), [after](after/connections.png), [light](after/connections-light.png) |
| 8. Connection verbosity | Removed the separate Access section and chat mention instructions. | [Before](before/connection-detail.png), [after](after/connection-detail.png) |
| 9. Plan changes | Active subscriptions have an explicit Change plan action and confirmation using the existing billing operation and prices. | [Plan fixture](after/billing.png), [confirmation](after/billing-confirmation.png) |
| 10. Memory pagination | The next page loads when its sentinel approaches the viewport. Failed pages retain an explicit retry. | [Automatic loading fixture](after/memories-autoload.png) |
| 11. Gmail open tracking | Gmail sends use the existing signed tracking image and organization setting. Private mailbox records retain approximate image-load activity. | [Activity fixture](after/gmail-image-load-activity.png), [rollout](../../outbound-mail-feedback.md) |
| 12. Settings breadcrumbs | Settings is a nonclickable hierarchy label. Actual parent categories remain links. | [Connection details](after/connection-detail.png) |
| 13. Assistant launchers | Removed the sidebar launcher and placed controls in main-view headers. | [Compose](after/compose.png), [labels](after/labels.png), [snippets](after/snippets.png), [organizer](after/organize.png) |
| 14. Startup preference | Added a per-user device Default view preference for mail categories, Calendar, and Compose. It preserves the default mailbox choice. | [Before](before/preferences.png), [after](after/preferences.png) |
| 15. Scrollbar clearance | Thin native scrollbars, symmetric gutters, and content clearance keep scrollbars away from rows. | [User reference](before/firefox-scrollbar-reference.png), [Firefox inbox](after/firefox-inbox.png), [Firefox mailbox picker](after/firefox-mailbox-scroll.png) |
| 16. Inline organization | A named Organize mailbox navigation entry opens an inline rules workspace using shared settings layouts. | [Before](before/organize.png), [after](after/organize.png), [narrow](after/organize-narrow.png), [light](after/organize-light.png) |

## Before and after

### Composer

| Before | After |
| --- | --- |
| ![Original composer](before/compose.png) | ![Updated composer](after/compose.png) |

The To and Subject fields have their own rounded Detail fill. Header fields and Cc/Bcc controls share a 40px height, 14px corners, and 13px type. Labels, body text, attachments, and footer actions share a 16px inset. Field rows and recipient buttons use 8px gaps. The assistant control moved to the main view's upper right.

The spacing review also corrected the inline writing area: it grows with its content, including expanded recipients and attachments. Narrow toolbars keep Send and the attachment actions together; the keyboard shortcut label appears when there is room.

| Spacing review reference | Final geometry |
| --- | --- |
| ![User's composer spacing reference](before/composer-spacing-reference.png) | ![Corrected Paper composer detail](paper/composer-detail.png) |
| ![First implementation before spacing refinement](before/compose-spacing-pass.png) | ![Final aligned composer](after/compose.png) |

### Calendar

| Before | After |
| --- | --- |
| ![Original calendar sidebar](before/calendar.png) | ![Compact calendar sidebar and continuous month](after/calendar.png) |

![Calendar visibility popover](after/calendar-picker.png)

### Connections

| Before | After |
| --- | --- |
| ![Original connection artwork](before/connections.png) | ![Official connection artwork](after/connections.png) |
| ![Verbose connection detail](before/connection-detail.png) | ![Shorter connection detail](after/connection-detail.png) |

Artwork sources are [Microsoft](https://www.microsoft.com/en-us/microsoft-365/onedrive/online-cloud-storage), [ClickUp](https://clickup.com/brand), [Todoist](https://www.todoist.com/press), and [Linear](https://linear.app/brand).

### Preferences

| Before | After |
| --- | --- |
| ![Original preferences](before/preferences.png) | ![Default view preference](after/preferences.png) |

### Mailbox organization

| Before | After |
| --- | --- |
| ![Original organizer dialog](before/organize.png) | ![Inline organizer workspace](after/organize.png) |
| ![Original sidebar rules icon](before/managed-inbox.png) | ![Named organizer navigation](after/managed-inbox.png) |

## New behavior and additional states

Billing and image-load screenshots use browser-only sample query data in the actual product components. The baseline billing account had no active subscription. The active-plan fixture exposes Change plan and its confirmation; the confirmation was cancelled. No checkout, subscription mutation, or real AI request was executed.

The memory fixture started with 20 items. Scrolling loaded eight more through the actual infinite-query observer without a Load more button. The mailbox-picker overflow fixture repeats synthetic rows only in the browser to exercise scrollbar clearance.

| State | Screenshot |
| --- | --- |
| Focused composer | ![Focused composer](after/compose-focused.png) |
| Focused assistant with sample plan access | ![Focused assistant](after/assistant-focused.png) |
| Inline forward with a sample attachment and retained quote | ![Inline assistant forward](after/inline-ai-forward.png) |
| Expanded inline forward on a narrow screen | ![Expanded inline forward](after/inline-forward-expanded-narrow.png) |
| Active plan fixture | ![Change plan action](after/billing.png) |
| Plan confirmation | ![Plan confirmation](after/billing-confirmation.png) |
| Automatic memory page loading fixture | ![Loaded memory page](after/memories-autoload.png) |
| Gmail tracking activity fixture | ![Gmail tracking activity](after/gmail-image-load-activity.png) |
| Labels header launcher | ![Labels](after/labels.png) |
| Snippets header launcher | ![Snippets](after/snippets.png) |
| Narrow composer | ![Narrow composer](after/compose-narrow.png) |
| Expanded recipient fields at 390px | ![Expanded composer](after/compose-expanded-narrow.png) |
| Composer at 320px | ![320px composer](after/compose-320.png) |
| Light composer | ![Light composer](after/compose-light.png) |
| Narrow organizer | ![Narrow organizer](after/organize-narrow.png) |
| Light organizer | ![Light organizer](after/organize-light.png) |
| Light connections | ![Light connections](after/connections-light.png) |
| Firefox inbox | ![Firefox inbox scrollbar](after/firefox-inbox.png) |
| Firefox mailbox overflow fixture | ![Firefox mailbox picker scrollbar](after/firefox-mailbox-scroll.png) |

## Paper exports

| View | Export |
| --- | --- |
| Composer | ![Paper composer](paper/compose.png) |
| Composer spacing detail | ![Paper composer detail](paper/composer-detail.png) |
| Reply | ![Paper reply](paper/reply.png) |
| Shared composer examples | ![Paper composer components](paper/composer-components.png) |
| Shared field actions | ![Paper field actions](paper/field-actions.png) |
| Continuous month, full content | ![Paper continuous month](paper/calendar-month.png) |
| Calendar visibility popover | ![Paper calendar picker](paper/calendar-picker.png) |
| Inline organizer | ![Paper organizer](paper/organizer.png) |
| Preferences | ![Paper preferences](paper/preferences.png) |
| Connected apps | ![Paper connected apps](paper/connected-apps.png) |
| Tracking image activity | ![Paper tracking activity](paper/image-load-activity.png) |

## Verification and rollout

See [validation](validation.md) and the [decision trail](decisions.tsv). The additive `20261107111600_boring_magik` migration was applied to the allowlisted development database only. Production needs that migration before this release deploys. Real Gmail sending, reconciliation, and public tracking-image loads still need a dedicated test mailbox. No production migration or deployment occurred.
