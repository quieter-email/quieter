# Product visual review

This pass addresses typography, corner radii, icon treatment, hierarchy, and contrast across the shared web and desktop product. Geist remains the product font. It now has consistent heading and label weights, and web uses the same self-hosted font source as desktop. Default panels use flat backgrounds and a smaller corner scale. Product icons use one shared stroke, size, tone, and loading contract.

The [Capy reference](https://capy.ai/) informed the restrained controls and clearer hierarchy. Existing workspace layout, density, and mail interactions remain in place. Marketing sources and artwork were kept separate.

There are 39 matched views, with 78 screenshots. Desktop captures use 1440 by 960 pixels. Narrow captures use 390 by 844 pixels. Mail, names, and addresses come from the existing synthetic preview personas. Demo timestamps reflect capture time. The screenshots use the same scenarios, themes, assistant state, and viewports.

The before images were captured before presentation edits at [the starting revision](https://github.com/quieter-email/quieter/commit/d4605384045fe9515b853e18092f5a39e1c95d5d). The [baseline commit](https://github.com/quieter-email/quieter/commit/56491cad4b854a77d8542d2719010beebfc60d74) contains the capture recipe and original images.

## Verification

[Check output](checks.txt) records the lint, type, test, boundary, and production-build runs. The tests reported 1,114 passed and 276 skipped. The full check reported three existing React compiler warnings. Web and desktop builds passed. Native Electron sign-in and OS integration were not exercised.

[Contrast results](contrast.json) cover ten themes, five solid backgrounds, categorical and state-colored pills, foreground and muted text, action states, and the focus color. These samples meet 4.5:1 for text and 3:1 for focus color. The weakest sampled pill is 4.57:1. The browser resolves CSS colors through Canvas before measuring sRGB luminance. Its isolated color probe disables transitions so reduced-motion color transitions cannot return a previous sample. The sample uses each gradient's surface endpoints and a conservative 15 percent pill tint. It does not establish the accessibility of arbitrary email HTML, user-selected colors, every component state, or the whole application.

Chrome checks also covered visible keyboard focus on search and invalid input, dialog Tab navigation, Escape dismissal and focus restoration, narrow conversation headings, and full-width dialog actions. The assistant screenshot shows its initial disabled composer. Provider generation, real sending, OAuth, billing checkout, and account deletion were not performed. The shared development database lacks the existing memory-bootstrap table, so the Memories flow remains unverified. The work introduces no schema or provider changes.

## Reproduce the captures

Use the existing development setup in [the development guide](../../development.md). Copy approved development configuration into the ignored worktree location and run `vp run env:doctor`. Keep telemetry and provider writes disabled. Build the environment and observability packages before starting a fresh checkout.

```bash
vp install --frozen-lockfile
vp run @quieter/env#build
vp run @quieter/observability#build
vp run env:doctor
vp dev apps/web --port 3024 --host 127.0.0.1 --configLoader native
```

Choose an unused loopback port and set `BETTER_AUTH_URL` to that origin. In a second terminal, run the capture script against it.

```bash
vp exec node scripts/capture-product-ui.ts after http://localhost:3024
```

The capture script pins agent-browser 0.39.2. Use `--contrast-only` to rerun its color samples without recapturing screenshots. The script signs in through the established preview UI for full captures. This creates synthetic development-account records. It never connects a real mailbox or sends mail. It captures the listed states, samples contrast after CSS loads, and closes its own browser session. To record a baseline for another change, run the script with `before` before making presentation edits.

## Screenshot comparisons

<details>
<summary>Desktop light, 16 comparisons</summary>

| View | Before | After |
| --- | --- | --- |
| Inbox | ![Before Inbox](before/inbox-light.png) | ![After Inbox](after/inbox-light.png) |
| Conversation and attachment | ![Before Conversation and attachment](before/conversation-light.png) | ![After Conversation and attachment](after/conversation-light.png) |
| Compose | ![Before Compose](before/compose-light.png) | ![After Compose](after/compose-light.png) |
| Structured search | ![Before Structured search](before/search-light.png) | ![After Structured search](after/search-light.png) |
| Labels | ![Before Labels](before/labels-light.png) | ![After Labels](after/labels-light.png) |
| New label dialog | ![Before New label dialog](before/label-dialog-light.png) | ![After New label dialog](after/label-dialog-light.png) |
| Snippets | ![Before Snippets](before/snippets-light.png) | ![After Snippets](after/snippets-light.png) |
| Snippet editor | ![Before Snippet editor](before/snippet-dialog-light.png) | ![After Snippet editor](after/snippet-dialog-light.png) |
| Preferences | ![Before Preferences](before/preferences-light.png) | ![After Preferences](after/preferences-light.png) |
| Keyboard shortcuts | ![Before Keyboard shortcuts](before/shortcuts-light.png) | ![After Keyboard shortcuts](after/shortcuts-light.png) |
| Account | ![Before Account](before/account-light.png) | ![After Account](after/account-light.png) |
| Connected apps | ![Before Connected apps](before/connections-light.png) | ![After Connected apps](after/connections-light.png) |
| Mailboxes | ![Before Mailboxes](before/mailboxes-light.png) | ![After Mailboxes](after/mailboxes-light.png) |
| Add a mailbox | ![Before Add a mailbox](before/add-mailbox-light.png) | ![After Add a mailbox](after/add-mailbox-light.png) |
| Assistant | ![Before Assistant](before/assistant-light.png) | ![After Assistant](after/assistant-light.png) |
| Shared component reference | ![Before Shared component reference](before/components-light.png) | ![After Shared component reference](after/components-light.png) |

</details>

<details>
<summary>Desktop dark, 16 comparisons</summary>

| View | Before | After |
| --- | --- | --- |
| Inbox | ![Before Inbox](before/inbox-dark.png) | ![After Inbox](after/inbox-dark.png) |
| Conversation and attachment | ![Before Conversation and attachment](before/conversation-dark.png) | ![After Conversation and attachment](after/conversation-dark.png) |
| Compose | ![Before Compose](before/compose-dark.png) | ![After Compose](after/compose-dark.png) |
| Structured search | ![Before Structured search](before/search-dark.png) | ![After Structured search](after/search-dark.png) |
| Labels | ![Before Labels](before/labels-dark.png) | ![After Labels](after/labels-dark.png) |
| New label dialog | ![Before New label dialog](before/label-dialog-dark.png) | ![After New label dialog](after/label-dialog-dark.png) |
| Snippets | ![Before Snippets](before/snippets-dark.png) | ![After Snippets](after/snippets-dark.png) |
| Snippet editor | ![Before Snippet editor](before/snippet-dialog-dark.png) | ![After Snippet editor](after/snippet-dialog-dark.png) |
| Preferences | ![Before Preferences](before/preferences-dark.png) | ![After Preferences](after/preferences-dark.png) |
| Keyboard shortcuts | ![Before Keyboard shortcuts](before/shortcuts-dark.png) | ![After Keyboard shortcuts](after/shortcuts-dark.png) |
| Account | ![Before Account](before/account-dark.png) | ![After Account](after/account-dark.png) |
| Connected apps | ![Before Connected apps](before/connections-dark.png) | ![After Connected apps](after/connections-dark.png) |
| Mailboxes | ![Before Mailboxes](before/mailboxes-dark.png) | ![After Mailboxes](after/mailboxes-dark.png) |
| Add a mailbox | ![Before Add a mailbox](before/add-mailbox-dark.png) | ![After Add a mailbox](after/add-mailbox-dark.png) |
| Assistant | ![Before Assistant](before/assistant-dark.png) | ![After Assistant](after/assistant-dark.png) |
| Shared component reference | ![Before Shared component reference](before/components-dark.png) | ![After Shared component reference](after/components-dark.png) |

</details>

<details>
<summary>Narrow layouts, 5 comparisons</summary>

| View | Before | After |
| --- | --- | --- |
| Inbox light | ![Before Inbox light](before/inbox-light-narrow.png) | ![After Inbox light](after/inbox-light-narrow.png) |
| Conversation and attachment light | ![Before Conversation and attachment light](before/conversation-light-narrow.png) | ![After Conversation and attachment light](after/conversation-light-narrow.png) |
| Compose dark | ![Before Compose dark](before/compose-dark-narrow.png) | ![After Compose dark](after/compose-dark-narrow.png) |
| Preferences dark | ![Before Preferences dark](before/preferences-dark-narrow.png) | ![After Preferences dark](after/preferences-dark-narrow.png) |
| New label dialog light | ![Before New label dialog light](before/label-dialog-light-narrow.png) | ![After New label dialog light](after/label-dialog-light-narrow.png) |

</details>

<details>
<summary>Sign in and onboarding, 2 comparisons</summary>

| View | Before | After |
| --- | --- | --- |
| Sign in dark | ![Before Sign in dark](before/auth-dark.png) | ![After Sign in dark](after/auth-dark.png) |
| Onboarding dark | ![Before Onboarding dark](before/onboarding-dark.png) | ![After Onboarding dark](after/onboarding-dark.png) |

</details>
