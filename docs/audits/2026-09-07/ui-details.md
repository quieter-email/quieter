# UI state, shared controls, and small interaction defects

Additional findings at the original application baseline. Pinned source links support the reported behavior; validation distinguishes local reproductions from source-only traces.

## F80

### P2: Saving reordered milestones can leave the form permanently dirty

Location: [apps/web/src/features/settings/components/organization-settings/organization-mail-usage-settings.tsx:566](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/organization-settings/organization-mail-usage-settings.tsx#L566) (through line 572), `:535-538`, `:779-787`.

Problem: Dirty detection compares milestone positions. Save success only invalidates the query, relying on a key derived from saved settings to reset the local form. The server sorts milestones. When the normalized result equals the original saved settings, that key does not change and the local order survives.

Verified case: Start with saved `[50,80,100]`. Change the three existing rows to `[80,100,50]`, then save. The final values are unique and valid. [packages/billing/src/organization-mail-usage.ts:94](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/billing/src/organization-mail-usage.ts#L94) (through line 103) normalizes them back to `[50,80,100]`. [packages/orpc/src/routers/organization-mail-usage.ts:75](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/organization-mail-usage.ts#L75) (through line 106) accepts the integers, saves them and returns the overview. The component key remains identical, but its position-sensitive dirty comparison stays true. Repeated saves do not clear it. An executable probe confirmed both comparisons.

Consequence: A successful save continues to show “Unsaved changes” and enables repeated identical writes.

Smallest good fix: Compare the milestone sets in canonical sorted order. If the UI should also display the canonical order after saving, reconcile the submitted rows with the successful result without replacing newer edits. Do not replace editable state with a value derived directly from props, as the diagnostic suggests.

Rounding qualification: No additional rounding bug was established. The client rounds dollars to cents before both comparison and submission at `:561-562`; the API requires integer milestones. Sorting is the verified case.

## F81

### P2: Usage settings accept edits during save and then discard them

Location: [apps/web/src/features/settings/components/organization-settings/organization-mail-usage-settings.tsx:389](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/organization-settings/organization-mail-usage-settings.tsx#L389), `:404`, `:453`, `:489-492`, `:779-787`. Milestone controls are at `:283` and `:328`.

Problem: `isSaving` disables Save, but the switch, amount field, milestone fields and add/remove controls remain editable. Successful invalidation changes the settings-derived key and remounts the entire form.

Verified case: Change the limit from $10 to $20 and save. While the request is pending, change it to $30. When the response/refetch supplies $20, the key changes and the $30 draft disappears. The UI gives no indication that it discarded a newer edit. This is separate from F80, which needs an unchanged key.

Consequence: Accepted input can vanish during a normal slow save. A fresh external settings update can also reset a draft for the same reason.

Smallest good fix: At minimum, disable every editing control for the duration of the save and its awaited invalidation. A fuller fix is to key by organization identity and reconcile saved values only if the draft still matches the submitted version, preserving later edits.

## F82

### P2: Managed mailbox name remains at an unsaved value after failure

Location: [apps/web/src/features/settings/components/managed-mailbox-detail-settings.tsx:445](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/managed-mailbox-detail-settings.tsx#L445) (through line 457).

Problem: The name input is uncontrolled, initialized with `defaultValue`, and keyed only by mailbox ID. Every blur submits its DOM value. Cache rollback/refetch cannot reset that value after a failed save.

Caller verification: `managed-mailbox-manager-settings-section.tsx:164-165` directly forwards the input to the mutation. `use-mailbox-detail-mutations.ts:84-105` reports failure and restores cached data; `:173-187` invalidates queries on settlement. Neither updates or remounts this DOM input for the same mailbox. The adjacent division control at `managed-mailbox-detail-settings.tsx:473-489` is controlled from the query result.

Consequence: After a rename fails, the field still shows the failed name while the heading and other query-backed views show the saved name. Focusing and leaving the field also writes when nothing changed.

Smallest good fix: Use a local draft with an explicit saved/dirty comparison, submit only changes, and show pending/error status while preserving a failed draft for retry. Reconcile a successful saved value only when no later edit exists. Do not rely on `defaultValue` to follow query updates.

## F83

### P3: Clearing a Gmail name never reaches a clean saved state

Location: [apps/web/src/features/settings/components/gmail-mailbox-name-settings.tsx:26](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/gmail-mailbox-name-settings.tsx#L26) (through line 40), `:57`, `:79-82`.

Problem: An empty field submits `null`, but the saved baseline converts null or blank names to the literal string `Gmail`. Local empty text is therefore always dirty against the baseline, including after a successful save.

Verified case: Clear an existing name and save. The submitted value is null, query invalidation completes, `savedDisplayName` becomes `Gmail`, and `displayName.trim()` remains empty. The caller at `mailbox-detail-settings-content.tsx:148` keys only by mailbox ID, so saving cannot reset the field.

Consequence: Save stays enabled after success and can repeat the same write indefinitely. This is not a cross-mailbox state leak; that caller key correctly prevents one.

Smallest good fix: Compare the normalized stored values, treating blank as null on both sides. Keep `Gmail` as the placeholder/display fallback rather than the stored-value dirty baseline.

## F84

### P2: IME confirmation can submit an unfinished chat prompt

Location: [packages/ui/src/components/ui/token-field.tsx:354](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/token-field.tsx#L354) (through line 370); [apps/web/src/features/chat/components/chat-view.tsx:451](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-view.tsx#L451) (through line 457).

Problem: TokenField tracks composition and suppresses `handleInput` while composing at `:253-257`, but its key handler does not check that flag or the event's composition state. Chat's parent handler submits on every unshifted Enter.

Caller verification: [apps/web/src/features/chat/components/chat-composer.tsx:127](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-composer.tsx#L127) (through line 138) passes the parent handler directly to TokenField. `chat-view.tsx:349-365` submits the current React input value and clears it. With an existing prompt prefix, Enter used to confirm an IME candidate can reach this submission path before the composed text reaches React state. If suggestions are open, TokenField can instead treat the same Enter as suggestion selection.

Consequence: Users typing with an IME can send a partial prompt or replace a mention while confirming text.

Smallest good fix: Return from TokenField's keyboard processing while `composingRef.current` or `event.nativeEvent.isComposing` is true, before suggestion handling and parent dispatch. Guard the chat submission handler as well if it remains reusable outside TokenField.

## F85

### P2: Multiple mentions force a full editable-DOM rebuild on every input

Location: [packages/ui/src/components/ui/token-field.tsx:62](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/token-field.tsx#L62) (through line 66), `:264-276`; [packages/ui/src/components/ui/token-field-dom.ts:278](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/token-field-dom.ts#L278) (through line 281).

Problem: `getSegmentTokenIds` joins token text with a space; `readRenderedTokenIds` joins the same text with a NUL character. With two or more mentions the signatures never match, even when all rendered tokens are already correct.

Verification: A probe imported the real segment parser and DOM signature reader, supplied token attributes for `@Calendar @Drive`, and produced `"@Calendar @Drive"` versus `"@Calendar\u0000@Drive"`. The input handler therefore enters `renderSegments` on every ordinary keystroke. That function calls `root.replaceChildren` at `token-field-dom.ts:224` and the handler restores only the caret offset. ChatComposer is a live caller at [apps/web/src/features/chat/components/chat-composer.tsx:127](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-composer.tsx#L127).

Consequence: Typing after multiple mentions repeatedly destroys and recreates the whole editable subtree, including token images, instead of retaining the browser's existing editing nodes. This adds unnecessary DOM work and interferes with native editing history. Browser-specific undo behavior was not measured.

Smallest good fix: Use the same delimiter in both signatures. A focused multi-token input test should verify that ordinary text input does not rebuild unchanged token nodes.

## F86

### P2: Settings search result activation requires a mouse-down event

Location: [apps/web/src/features/settings/components/settings-search.tsx:126](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/settings-search.tsx#L126) (through line 149).

Problem: Result buttons perform selection only in `onMouseDown`; there is no `onClick`. An assistive-technology activation that dispatches a click has no action. The input's Enter handler at `:94-101` is a separate path and does not supply an activation handler to the result buttons.

Caller verification: SettingsSearch invokes the real `onSelectTab` callback through `selectTab` at `:35-40`. The result nodes also remain in the tab sequence even though this combobox uses `aria-activedescendant` on its input, and the input's blur closes the list at `:66-68`.

Consequence: Pointer selection and typing Enter can work while direct activation of an exposed result does nothing. Tabbing toward a result also closes the list rather than providing a stable result focus target.

Smallest good fix: Use mouse-down only to prevent input blur, select in `onClick`, and set result `tabIndex={-1}` for the existing active-descendant focus model. TokenFieldSuggestions already uses this event split in [packages/ui/src/components/ui/token-field.tsx:108](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/token-field.tsx#L108) (through line 122).

## F87

### P3: Domain mode cards look clickable but only their radio circles work

Location: [apps/web/src/features/settings/components/organization-settings/register-domain-dialog.tsx:190](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/organization-settings/register-domain-dialog.tsx#L190) (through line 232).

Problem: A `cursor-pointer` card contains a native radio and sibling text, but the card is a plain div with no handler, and neither text span is a label. Clicking the visible label or card padding does not select its mode. Its explanatory text is also not associated with the radio.

Caller verification: `organization-settings/domains-view.tsx:173-178` renders RegisterDomainDialog without `fixedMode`, so these cards are present in the normal register-domain flow. This is not limited to dormant code. The shared package already supplies `RadioGroup`, `Radio` and `RadioIndicator` in [packages/ui/src/components/ui/radio-group.tsx:11](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/radio-group.tsx#L11) (through line 49).

Consequence: The primary choice has a much smaller working target than its styling promises and bypasses the project's shared-control convention without a functional need.

Smallest good fix: Use the shared radio group and label each entire card, keeping the current layout. Associate descriptions through IDs and `aria-describedby`.

## F88

### P3: Empty token suggestions advertise an active option that does not exist

Location: [packages/ui/src/components/ui/token-field.tsx:173](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/token-field.tsx#L173) (through line 175), `:395`, `:96-99`.

Problem: `isOpen` depends on a query and enabled state, not on whether any suggestions match. With no matches, the list renders only an empty-message paragraph, but the combobox still sets `aria-activedescendant` to option zero.

Caller verification: ChatComposer provides connected connector tokens and allows arbitrary mention text at [apps/web/src/features/chat/components/chat-composer.tsx:127](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-composer.tsx#L127) (through line 138). Typing an unmatched mention reaches this state. The settings search implementation correctly guards its active-descendant reference with an existing-result check at `settings-search.tsx:53-57`.

Consequence: The combobox exposes a dangling active-option reference to assistive technology instead of accurately representing an empty result list.

Smallest good fix: Set `aria-activedescendant` only when `suggestions[activeIndex]` exists. Also bound the active index when a refreshed token list shrinks.

## F89

### P3: Keyboard shortcuts close button omits the required shared tooltip

Location: [apps/web/src/features/hotkeys/components/keyboard-shortcuts-dialog.tsx:187](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/hotkeys/components/keyboard-shortcuts-dialog.tsx#L187) (through line 189).

Problem: The icon-only close control has an accessible name but no tooltip. `FullPageDialogClose` at [packages/ui/src/components/ui/full-page-dialog.tsx:72](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/full-page-dialog.tsx#L72) (through line 86) supplies neither tooltip content nor a default wrapper.

Caller/convention verification: The corresponding organizer close control is wrapped in `IconButtonTooltip` at `navigation/components/mailbox-organizer.tsx:1964-1968`, as is the label editor at `navigation/components/sidebar-label-nav.tsx:772-776`. Those two are not findings.

Consequence: This control omits the mouse/focus explanation required by the repository's icon-control convention. It is not an unnamed-button accessibility defect.

Smallest good fix: Wrap this one close control in `IconButtonTooltip` using its existing label.

## F90

### P3: Message-image error handling uses a redundant ref and synchronization effect

Location: [apps/web/src/features/message-thread/components/message-body.tsx:119](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/components/message-body.tsx#L119) (through line 121), `:151-177`.

Problem: A no-op callback ref is initialized, a separate effect replaces its implementation whenever `shouldLoadImages` changes, and the listener effect installs another function that forwards to that ref. The indirection exists only to let a persistent external listener read the latest image preference.

Caller/convention verification: This is the live HTML message renderer. The repository already uses `useEffectEvent` for the same latest-values-in-an-effect requirement, for example `features/navigation/components/mail-sidebar.tsx:797-801`. Shadow DOM rendering itself is a necessary external synchronization effect and should stay.

Consequence: Three pieces must be read together to understand one error callback, with an unnecessary no-op state and effect-order dependency. No current image-error race is claimed.

Smallest good fix: Put the image-error logic in `useEffectEvent` and call it from the installed listener, removing the callback ref and its assignment effect. Retain the listener cleanup.

## F91

### P2: Transcription completion can append after the active mailbox changes

Location: [apps/web/src/features/compose/components/compose-workspace.tsx:236](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/compose-workspace.tsx#L236) (through line 275); [apps/web/src/features/mailbox/components/mailbox-workspace.tsx:575](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/mailbox/components/mailbox-workspace.tsx#L575) (through line 594).

Problem: The transcription request captures `mailboxId`, but its completion reads and writes the live form without checking that the active mailbox still matches. Switching between regular mailboxes keeps the compose category and component instance.

Verified path: Start transcription while composing in mailbox A. Before it resolves, select mailbox B in the sidebar. `mail-sidebar.tsx:695` forwards that selection, and `mailbox-switcher.tsx:1008` invokes it without an audio-pending guard. `selectMailboxId` updates `mailboxId` but leaves `mailbox` unchanged for non-API mailboxes. `mailbox-workspace-content.tsx:319-324` keys ComposeWorkspace only by `composeSessionKey`, and this selection path does not increment that key. The existing ComposeSurface now receives mailbox B, while the old request still carries mailbox A. Its completion at `compose-workspace.tsx:257-267` appends to the same form now shown under B. `audioBusy` disables sending and template tools at `:203-204`, `:554` and `:569`; it does not disable the mailbox switcher.

Consequence: Work requested under one mailbox can modify the compose session now associated with another mailbox. Request context and billing scope remain A while the visible compose scope is B. This is an isolation/ownership mismatch, not a claim that the server authorizes access to someone else's mailbox.

Smallest good fix: Capture a compose operation identity containing mailbox ID and local draft ID, then check both against the current session before applying either success or error. Invalidate the operation when the mailbox changes or the composer closes. If results should survive navigation, store them against the initiating session rather than applying them to whichever form is current. A local draft ID alone is insufficient because this mailbox-switch path preserves it.

Boundary qualification: Opening a different draft through `openComposeWorkspace` increments the session key at `mailbox-workspace.tsx:164`, and inline composers use `inlineDraft.localId` at `message-view.tsx:1631`. Those paths create a different form instance, so the proposed arbitrary cross-draft write was rejected. `openComposeDraft` has no current external caller. Close/discard remain available during transcription, but no claim is made that a response to an unmounted form changes a newly mounted draft.
