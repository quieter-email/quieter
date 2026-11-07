# Actual application verification

Verified through the normal authenticated application and Cloudflare Worker on port 3052, backed by migrated disposable PostgreSQL with Lead and pgvector. A synthetic private mailbox and conversation used ordinary source tables and authorization. Search calls used the current development embedding provider. No RPC or page mocks were used.

- **Conversation search.** “release timing” found the saved launch-planning conversation. Clicking the result selected the original chat and displayed its stored message.
- **Mail search.** “overnight air travel” found the travel-preference message. Clicking it opened the canonical thread route with its mailbox, message and thread identities, and the reader displayed the original body.
- **Calendar navigation.** The same search reproduced the review finding from the calendar workspace. Before the fix, the result added message and thread identities but retained `workspace=calendar`, leaving the reader hidden. After the fix, clicking the result removed that workspace parameter and displayed the original mail body in the reader.
- **Partial preparation.** Adding synthetic history produced 17 of 21 prepared messages. The UI disclosed incomplete coverage. **Continue preparing search** reached 21 of 21 and removed the continuation action.
- **Stop.** **Stop background preparation** removed the owned chat registration, verified independently in PostgreSQL. Retained content and completed vectors remained available.
- **Older mail.** The Gmail fixture showed the AI-balance notice before opt-in. **Prepare older mail** persisted an import request and displayed pending preparation. The stop action canceled it before any provider import. The actual paged importer and recovery behavior have separate transport and database tests; no live Gmail history was downloaded in this verification.
- **Responsive layout.** Results remained readable in the narrow dark dialog and desktop light dialog. The native thread reader opened correctly at narrow width.

| State | Screenshot |
| --- | --- |
| Conversation result | [Desktop light](../../screenshots/semantic-search/conversation-results-light.png) |
| Mail result | [Desktop light](../../screenshots/semantic-search/mail-results-light.png) |
| Mail result | [Narrow dark](../../screenshots/semantic-search/mail-results-narrow-dark.png) |
| Canonical message reader | [Narrow dark](../../screenshots/semantic-search/opened-mail-narrow-dark.png) |
| Mail reader opened from calendar search | [Desktop light](../../screenshots/semantic-search/calendar-to-mail-light.png) |
| Incomplete preparation | [Desktop light](../../screenshots/semantic-search/partial-preparation-light.png) |
| Older-mail balance notice | [Before opt-in](../../screenshots/semantic-search/older-mail-opt-in-light.png) |
| Durable import request | [After opt-in](../../screenshots/semantic-search/older-mail-requested-light.png) |

The browser, server and disposable database belong to this task. The browser and server were stopped after verification, and approved ignored development configuration was restored and passed `env:doctor`. Kernel OOM records confirmed the earlier interrupted browser attempts; successful verification followed after reducing the owned server heap and leaving unrelated services untouched.

All displayed data is synthetic. No production deployment, migration, account-key change or real mailbox mutation occurred.
