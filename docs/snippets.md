# Mailbox snippets

Snippets are named, plain text fragments owned by one mailbox. Everyone who can access that mailbox can list, create, edit, and delete its snippets. A private mailbox exposes them only through its existing access policy. Snippets have no subject, layout, placeholder, AI fill, or personal/team scope.

Use the sidebar's **Snippets** button to manage the selected mailbox's saved text. In either the new-message or reply composer, type `/` at the start of a line or after a space. Continue typing to filter formatting commands and snippet names, including names containing spaces. Arrow keys choose an item, Enter or Tab applies it, and Escape leaves the typed text in place. A snippet replaces only the slash query at the cursor, preserving surrounding text and line breaks. It is inserted as text nodes, so markup in a snippet stays text.

The menu also offers **New snippet**. Selecting text in the composer exposes **Save snippet** in the toolbar, opening the same name/text dialog. Saving does not modify the draft. Autosave pauses while the slash menu is open and resumes after it closes, so a save cannot dismiss the menu mid-selection.

## Local verification

Use the normal isolated development settings and `vp run db:migrate`, then `vp run dev`. No background Worker or provider writes are needed for snippet CRUD. Use development mailboxes with explicit access grants for sharing checks; do not send mail during verification. Check creation, update, deletion, `/name` filtering, insertion between existing text, multiline text, literal markup, keyboard dismissal, saving selected text, mailbox switching, and denial without a mailbox grant.

## Release

The reviewed contract migration `20261012181407_melodic_hellion` creates `mailSnippet` and permanently drops `mailTemplate`. It intentionally discards all saved templates; there is no conversion or compatibility API. It has been applied to the allowlisted development database only.

Production requires a coordinated protected release. The standard workflow applies migrations before updating the web Worker; an old release using templates becomes incompatible once this migration runs, and it cannot be restored afterward through web-only recovery. Plan a maintenance window for this contract change, drain the old release, apply the reviewed migration through the protected production workflow, and publish/verify the prepared new build. Do not run it locally against production or treat this PR as deployment authorization.
