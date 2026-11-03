# AI trust boundaries

Quieter treats email, attachments, calendar content, connector results, tool metadata, navigation hints, and stored memory as untrusted model input. These sources can supply facts for an authorized task. They cannot grant tools, approve actions, change accounts, or authorize disclosure.

## Application instructions and task data

`packages/ai/src/prompt-security.ts` owns the shared security policy. The structured and text generation functions, action compiler, classification decisions, interactive chat, and background mail agent apply it at their model boundary. Task-specific instructions remain application-owned text.

Chat supplies navigation and personal context in a separate JSON user message marked `application_context`, before the canonical conversation. This message is application data, not a new human request. Memory serialization keeps `instructions` and `memory` in distinct JSON fields. Selected memory records also retain their `kind` and `source`. Saved preferences remain subordinate to the current request and application permissions. Learned observations remain fallible evidence.

Memory learning guidance and saved background task instructions occupy named JSON data fields. They never enter the system instruction string. Title generation also uses JSON instead of raw text delimiters. Label names, descriptions, and classification conditions remain in decision state, separate from application instructions.

This separation protects message roles and source provenance. JSON encoding does not make model interpretation immune to hostile instructions.

## Approval and disclosure

Interactive changes still require exact persisted approval, a current foreground lease, and authenticated mailbox access. The server compares the final tool, input, account, and exchange before execution. Canonical replay cannot restore unresolved approvals, and consumed actions cannot execute again.

In chat, mail searches, calendar event queries, and Linear lookups also require approval. Their arguments leave quieter even when they only search or read. The approval shows the complete query or tool arguments. Linear approvals also show the account and workspace. A mention enables discovery; it does not approve a query. Linear read classification uses the same explicit supported-tool set as background automation. Unknown names cannot acquire unattended read permission merely by starting with `get_`, `list_`, or `search_`. Execution checks current discovery and validates the original arguments against its schema without replacing the approved payload with schema transformations.

Background connector reads use literal `argumentTemplate` objects from the reviewed specification. The model cannot supply or interpolate their arguments. These reads require approved literal sender conditions and valid provider arguments. The argument-free calendar discovery tool uses only the approved account. Existing dynamic connector-read revisions fail closed and need review again before running. This tightening uses the existing specification and manifest digest; it requires no database migration.

Background connector writes retain their existing fixed templates and message bindings. Only approved content fields may copy the triggering message's subject or body. Destinations and resource identifiers remain fixed. A model's match decision can suppress an approved effect; it cannot choose new arguments. Reply drafts must retain the triggering message's Reply-To recipients, falling back to From. The server validates and supplies those addresses before recording or saving a draft. Drafts still require user review before sending.

## Output boundaries

Chat Markdown renders image descriptions as inert text, disables raw HTML, and allows only intentional HTTP, HTTPS, email, and validated internal mail-reference links. An injected image URL cannot automatically request an attacker's endpoint.

Search parsing validates generated labels, provider-supported `is` values, attachment filters, relative durations, and real calendar dates before returning a search. Invalid filters fail rather than silently broaden the query. Verification codes continue to require visible source evidence. Memory mutation continues to enforce user provenance, record ownership, and instruction-kind restrictions independently of model output.

## Verification and remaining limits

The regression tests exercise real SDK model requests with fake providers, exact approval and replay against disposable PostgreSQL, fixed connector arguments, recipient checks, and the actual Markdown renderer. Browser verification observes resource requests using synthetic content. No production mailbox, database, or model credentials are needed for these tests.

These controls constrain what model output can do. They do not prove universal prompt injection resistance or factual accuracy. A model can still misclassify mail, produce misleading prose, or retain an incorrect learned observation. Explicitly reviewed workflows can intentionally disclose data, and sender-address matching alone does not authenticate the sender. Mail, calendar, and personal-context reads remain bounded by the signed-in user's existing authorization. Real-model adversarial evaluations require separate development credentials and a budget; deterministic tests do not substitute for them.

The design follows [OWASP's prompt injection prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) by combining instruction/data separation with server-enforced capability and output controls.
