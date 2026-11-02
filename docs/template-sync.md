# Design templates locally

Edit React Email components in your project and preview the saved template in Quieter. Local sync uses the existing template API. It uploads rendered HTML and plain text. Your React source stays on your computer.

## Start a project

After the SDK release that includes the CLI is published, install it with your email dependencies:

```sh
vp add quieter react react-dom react-email @react-email/render
vp exec quieter templates init
```

The initializer creates `quieter.templates.json` and `emails/welcome.tsx`. It adds the local sync state, `.env.local`, and `.env.template-sync.local` to `.gitignore`. Existing template files are never replaced.

In Quieter, open **Templates**, then **Code locally**. Open the team's API-key settings and create a key with both **Templates read** and **Templates write**. Other permissions do not grant template access.

New team keys have a bounded per-minute request allowance for normal API and sync use. Keys created before this release retain their stored allowance. Rotate an older key if sync reaches that limit. Rotation keeps its explicit permissions. Rate-limited requests return HTTP 429 with `Retry-After`; the watcher retries transient failures with a bounded backoff.

Set `QUIETER_MAIL_API_KEY` in your shell, then start sync:

```sh
vp exec quieter templates dev
```

For an explicit environment file, keep the file ignored and pass its path:

```sh
vp exec quieter templates dev --env-file .env.local
```

When developing this repository, keep a development template key in a separate ignored file such as `.env.template-sync.local`. The repository's `.env.local` isolation check deliberately rejects mail API keys. Do not use a production key for local verification.

The CLI prints a template URL after an upload. Open that URL and edit `emails/welcome.tsx`. The template and a clean open editor refresh as changes arrive. A compilation or validation failure keeps the last saved version available.

To upload once, run `vp exec quieter templates push`. To sync one entry, add `--only welcome`. Use `--config path/to/quieter.templates.json` to select another manifest. Paths inside the manifest are relative to that manifest.

## Add templates and preview props

Keep `projectId` and each template's map key stable. Moving a file or renaming a template does not change its remote identity.

```json
{
  "projectId": "d9251dba-8bb5-4d9f-9432-028d64c5644c",
  "templates": {
    "welcome": {
      "name": "Welcome",
      "subject": "Welcome aboard",
      "source": {
        "kind": "react",
        "file": "emails/welcome.tsx",
        "props": { "firstName": "Alex" }
      }
    }
  }
}
```

A React source exports a default component. Import shared components and helpers normally. The `props` object supplies JSON preview values. Add `source.text` to preserve a custom plain-text alternative. Otherwise the React renderer generates it.

Use `source.kind: "html"` for an HTML file, with optional `source.text`. Use `"text"` for a plain-text file. Use `"visual"` for a visual-design JSON export from Quieter. All content passes the same validation as templates created in the app.

Changes within the project directory trigger another sync, including shared imports and manifest edits. Keep shared source files within that directory. Removing a file or manifest entry does not delete or archive its remote template.

## Connect an existing template

Open the existing template's **Code locally** dialog to copy its link command. With your local entry ready, run:

```sh
vp exec quieter templates link welcome TEMPLATE_ID
vp exec quieter templates dev
```

Linking accepts the template's current saved version as your baseline. The next sync replaces its editable fields with your local definition. Review your local source before starting sync.

## Resolve an edit conflict

If someone edits the saved template in Quieter, sync stops updating that entry and reports the conflict. Compare the local file with the saved version. To deliberately keep your local definition, link the entry again and push it. A racing edit still fails the server's version check.

If the browser has unsaved edits when a sync arrives, the browser keeps those edits. **Reload saved version** asks before discarding them. Sync does not write browser changes back to your source files.

Restore an archived template in Quieter before syncing it. Sync never restores archived targets automatically.

## Recover an interrupted command

Keep the ignored `.quieter/` directory. It holds remote IDs, accepted revisions, and pending upload content. It contains no API key. A retry replays the recorded request and checks whether an uncertain upload already succeeded.

Only one command can own a project's state at a time. After a process crash, follow the lock error's path and owner details. Confirm that the owning process has exited before removing its lock. Keep the state file so pending requests can recover.

If state was lost, unchanged initial content can recover through its creation receipt. Changed content conflicts instead of creating another template. Use the existing template's link command to recover the binding. Keep the manifest's project ID and entry keys when moving the project to another machine.

## Choose an API target

`--base-url` or `QUIETER_MAIL_API_URL` selects an HTTPS origin. Loopback HTTP is allowed for development. URLs with credentials, path prefixes, query strings, or fragments are rejected.

The first connection pins the origin and the key's authenticated team in the local state. Rotating a key for the same team preserves the bindings. A key for another team or a different origin fails before uploads. Use a separate project and state for a separate environment.

## Use the saved template

Select the synced template when creating a campaign in Quieter. Campaign drafts copy the selected content. Later template edits leave that copy and queued deliveries unchanged. Review the campaign before sending.

The programmatic API remains `POST /api/control` with the existing `templates.list`, `get`, `create`, `update`, `render`, `duplicate`, and `archive` operations. `templates.list` includes the authenticated `organizationId`, including for an empty library. The SDK exposes these operations through `client.templates`. See [the SDK examples](../packages/sdk/README.md#templates-and-campaigns).

Deploy the updated template API before publishing the CLI release. Use the existing [protected SDK publishing workflow](sdk-publishing.md). No new database migration, background service, or deployment secret is required.
