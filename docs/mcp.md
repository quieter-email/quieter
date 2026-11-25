# Connect an MCP client

Add `https://quieter.email/api/mcp` as a remote Streamable HTTP server in your MCP client. Select OAuth and sign in to Quieter when the client opens your browser. Review the app name, callback destination, and access before connecting. You can disconnect the client under **Settings → Account → Connected apps**.

For Codex, use:

```bash
codex mcp add quieter --url https://quieter.email/api/mcp
codex mcp login quieter
```

Quieter uses resource-bound OAuth tokens, PKCE, and dynamic client registration. The connected client acts with your current Quieter access. Gmail stays private to its owner, and managed mailboxes use the same grants as the web app. Team settings and transactional sending require the relevant team permissions.

## Find and run actions

Call `quieter_find_actions` to list domains. Pass a domain or a query to narrow the list. Pass an exact action to read its input schema and find the tool to call. Use `mail.listMailboxes` to get the `mailboxId` for mail actions. Search with `mail.listThreads` and open full message bodies with `mail.getThread`. Share the `webUrl` from a mail result when you want the user to open it in Quieter.

The resource `quieter://guide/workflows` and prompt `quieter-workflows` provide agent guidance for links, drafts, and approvals. Clients that only support tools can get the same guide from `quieter_find_actions`.

To send mail, show the final sender, recipients, subject, message, and attachments before asking the user to approve. Repeat the identical call with the returned approval token after they approve. An edit requires a new preview. Use `send_without_review` when the user expressly asks you to send without reviewing the text.

An explicit deletion of a small, exact selection can proceed directly. Resolve ambiguous targets before deleting. Inferred deletions, deletions with ten or more messages, and collection-level deletions require approval. The MCP client asks the user in the conversation and supplies their decision. Quieter binds the approval token to the client, account, and action payload.

Provider linking, passkeys, payment, and account security actions that require browser interaction return a link for the user to open. Regular product actions run through MCP with the account's existing permissions.

## Connect a transactional automation

For an existing automation, configure the same endpoint with `Authorization: Bearer YOUR_API_KEY` and `Quieter-Version: 2026-10`. Team keys support `send_email`, `transactional_get_delivery`, and `transactional_list_suppressions`. Use a stable idempotency key for retries of the same send. The team API key authorizes direct transactional automation. Interactive agents should use OAuth so Quieter can return message previews.

## Verify locally

Start Quieter with the normal local development setup and apply migrations to a disposable development database. Use the local web origin with `/api/mcp` for the MCP URL and set `BETTER_AUTH_URL` to the matching origin. Check that an unauthenticated call returns a browser sign-in challenge. After signing in and granting access, open a test mailbox, request a send preview, and disconnect the client in Account Settings. A subsequent request with the old access token should return HTTP 401.
