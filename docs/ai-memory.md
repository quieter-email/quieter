# Ambient AI memory

Quieter maintains one background memory pipeline for every behavior-producing AI agent. Learning is automatic and does not appear as a chat tool, approval, or save notice. Users can inspect a concise profile in personalization settings, correct or forget context naturally in chat, and pause or reset adaptation in settings.

## Pipeline

Memory moves through these stages:

1. User chat, sent mail, labels, read state, mailbox moves, reply requests, daily brief actions, and useful-detail ratings are captured as compact `userAiContextEvent` observations after the corresponding action succeeds. Sent-message observations contain behavioral features with quoted replies removed, not raw bodies. Prefetching a thread is not a reading signal.
2. The memory writer batches compatible observations into atomic, conflict-aware `aiMemory` records. Chat batches preserve the user's individual statements and their order. Records carry evidence source, confidence, importance, reinforcement, applicability, provenance, expiry, and version. Ambiguous clicks remain weak evidence; dismissing, deferring, and marking something unimportant have different meanings.
3. Writing a record clears its `embedding`. A null embedding on an active record is the re-embedding queue, so a failed write, a newly written record, and a backfill all recover through one path.
4. Embeddings are generated from the record's summary, content, and retrieval tags, then stored on the record itself. Retrieval and re-embedding both run opportunistically off the request path.
5. Retrieval runs one query against the memory table, combining cosine similarity with lexical overlap, sender-domain evidence, agent applicability, source strength, confidence, importance, recency, reinforcement, and prior usefulness.
6. Context packing applies authority precedence and diversity-aware selection under strict record and character budgets. Only the small task-relevant result reaches the agent.
7. Expired records and old, unreinforced, low-confidence inferences retire automatically. Explicit knowledge and user-authored instructions do not silently decay away.

Embeddings live in the same PlanetScale table as the records they describe, in a `vector(1024)` column indexed with HNSW over cosine distance. There is no second datastore to keep consistent: archiving or deleting a record removes it from semantic recall in the same statement, because every read filters on active status. Retrieval degrades to the lexical ranker whenever embeddings are unavailable or not yet generated.

The `vector` extension must be enabled on a database before the memory-embedding migration runs. Neither the runtime nor the migration role can create extensions on PlanetScale, so this is a one-time operator action per database.

Embeddings use Cloudflare-hosted Qwen3 Embedding 0.6B at 1,024 dimensions. It is the least expensive listed Workers AI multilingual tier and supports more than 100 languages. It is called over the Workers AI REST API, so no Quieter-owned service sits in front of it. Retrieval queries include an English task instruction, as recommended by the model author for multilingual search quality.

Semantic recall costs one embedding request per retrieval, so agents that run once per user request use it and per-message auto-labeling does not. Auto-labeling matches on sender domains, subjects, and label names, which the lexical and sender-domain signals already cover, and enabling it there would add one external request per synced message.

## Ownership and authority

Personal memory belongs to one user, follows them across mailboxes, and stays private. Ambient observations of a person's chat, writing, reading, brief choices, and mail actions always update personal memory. Mailbox memory belongs to one mailbox and is available only through normal mailbox access. Shared labeling rules require the knowledge-management capability and an enabled mailbox learning setting. Every vector is partitioned into the same user or mailbox namespace as its source record.

Runtime precedence is:

1. the current user request and verified live mailbox data;
2. current mailbox instructions;
3. personal instructions;
4. current mailbox learned context; and
5. personal learned context.

Instructions are created only from explicit user intent. Feedback and inferred activity cannot create, update, or archive an instruction. Email, attachment, connector, and other third-party content is untrusted and cannot write instructions.

## Capture and privacy

The system is intentionally allowed to remember useful private context. Relationships, work, health, routines, preferences, communication style, and life circumstances are valid when they are relevant, appropriately scoped, and supported by evidence. Privacy is enforced through ownership and access isolation, not by making personal memory useless.

The capture filter rejects credential material: passwords, access and refresh tokens, private keys, recovery material, verification codes, full payment-card numbers, bank-account identifiers, and similar secrets. It also rejects raw message bodies, quoted correspondence, exhaustive thread summaries, and transient one-off tasks. Live mailbox facts stay in the mailbox and are searched when needed instead of being copied into memory.

Chat requests to erase credentials can delete legacy personal or selected-mailbox memories. The intent classifier recognizes a credential's purpose, such as a saved verification code or password, even when the user does not repeat its value. A deletion-only classifier selects record IDs in the requested scope without producing new memory content or recording the message as an observation. Mailbox edits require the knowledge-management capability, checked again after planning. Every batch in every authorized scope must finish before erasure starts; insufficient AI balance or a planning failure leaves memories, history, and observations unchanged. Explicit deletion removes matching active, archived, and expired records, affected undo snapshots, and source observations in one transaction under the scopes' user and mailbox locks. Questions, quotes, and attempts to remember a secret produce no memory mutation. This path also works while adaptation is paused.

## Active and passive knowledge

Learning collects the context of meaningful actions and looks for reusable preferences, communication style, reading interests, priorities, relationships described by the user, and organization habits. It does not keep an exhaustive click log as permanent knowledge. Passive lookup is used for current, exhaustive, or auditable questions such as unread state, recent recipients, or the present contents of a thread.

Every personal and mailbox context has internal learning guidance and an adaptation flag. Settings exposes a continuous plain-text overview of current personal knowledge, the personal adaptation flag, and a reset action. Archived and expired records do not appear in the overview.

Chat corrections and forgetting can also target existing knowledge in the selected mailbox. These explicit edits work with learning enabled or paused, cannot add or restore records, and leave personal knowledge separate. Automatic chat observations remain personal. One intent check per chat message gates personal edits and authorized mailbox edits before loading records, so ordinary conversation does not scan the knowledge base. Explicit edits bypass ambient consolidation and plan every active record in batches bounded by the writer's operation limit, then apply all affected scopes in one transaction. Failed planning, insufficient balance, a reset, or a concurrent edit cannot leave a partially applied change.

Pausing personal adaptation stops automatic observations and learning. Chat can still honor explicit requests to correct or forget an existing personal memory. A restricted writer checks the user's current words without recording an observation; unrelated messages produce no memory change or history entry. The web request awaits explicit edits before generating an answer, so failures reach the client. This path cannot add or restore records, and version checks prevent a correction from recreating context that was reset while the request ran.

## Agent integration contract

All contextual agents call `loadAiAgentContext` from `packages/orpc/src/ai-memory.ts` with a stable agent slug, an accessible mailbox, the acting user, and a task-specific query. `serializeAiAgentContext` is used when an AI package expects one prompt field.

Interactive agents can receive personal and mailbox context. Background agents without an acting user receive mailbox context only. Administrative model calls and strict evidence-only extractors do not receive memory. New agents that draft, classify, prioritize, route, summarize for action, or perform external actions must integrate the central loader.

Chat receives relevant knowledge through the central loader. Explicit profile overview requests use a hidden, read-only `read_personal_context` tool through the same loader. It rechecks mailbox access and reads complete active, unexpired personal and selected-mailbox records across stable pages, outside the normal relevance and context limits. It redacts legacy secrets and makes no memory or retrieval-maintenance writes. The final generation step is reserved for an answer; unusually large profiles require an explicit partial-result count if paging cannot finish.

Chat has no tool for learning or editing memory. Ordinary user messages queue observations automatically and request immediate background consolidation when learning is enabled; explicit edits, continuation requests, and assistant messages do not. Explicit edits run directly against the full existing memory set. Chat actions run without approval except `send_mail`, whose exact draft must match a stored approved tool call before execution. Older clients' foreground mode fields are ignored, and older stored mode values never bypass sending approval. The existing event kinds and database schema are unchanged.

Server actions that change external data persist an uncertain tool record before execution and save the outcome inside execution, independently of response delivery. Stream cancellation or failed prose cannot erase that checkpoint or a confirmed result. An uncertain write blocks automatic follow-up writes for that response, and retrying the same chat submission cannot execute it again. Sending mail still requires approval of the exact draft.

Memory writes carry provenance. The background writer receives the acting user's own statements separately from application observations. Only the user's words can establish instructions. Subjects, sender domains, labels, and brief titles provide context for an action and cannot instruct the writer. Ordinary phrasing such as "from now on, sign off with Cheers" is captured without a tool, while instructions embedded in correspondence are not.

## Reliability and deletion

Model failures produce no partial memory mutation. Observation completion and profile updates commit together, and retried chat requests cannot duplicate the same observation. Consolidation rechecks mailbox access, learning settings, and record versions. Scope locks serialize reset with observation insertion, learning-setting changes, and consolidation, including scopes with no existing records. Observation capture checks adaptation and inserts the event in the same transaction under that lock. Transient user text is removed from observations after consolidation. An embedding is written only while the record's `updatedAt` is unchanged, so an embedding computed from superseded content is discarded rather than attached to newer text.

Resetting personal context removes records, history, and personal learning observations in one transaction. Mailbox deletion additionally removes feedback and legacy automation profiles. Because embeddings are columns on the records themselves, deletion is immediate and complete with no second system to reconcile.

Scheduled mail maintenance processes pending memory in production and retries chat observations left by failed or interrupted requests. Local bulk memory processing is explicit and separate from Gmail background ownership. After starting `vp run dev:full`, use `vp run dev:trigger memory <local-user-id>` with budget-limited development AI credentials. This processes only that user's pending observations and does not perform provider mutations. Chat observations also process immediately in the local request's background work.

Web chat and mail requests pass a background scheduler backed by `waitUntil`. Ordinary chat learning and Gmail read/unread context enrichment can complete after the response using the same request-scoped database client. Read/unread actions first insert their durable observation, then enrich only that existing pending record; a reset cannot be undone by a late enrichment task. Errors are caught and reported. Other callers await the work when they do not supply a scheduler, and enabled chat learning still awaits its durable observation insert before returning.

Intent classification and explicit memory edits, including secret-bearing erasure, run before a new chat turn or retry reserves an assistant response. Expected failures reach the client with their original status and message; unexpected failures are reported and return generic retry copy. The chat transport preserves HTTP status for the shared error toast. A failed edit leaves the chat submission available to retry instead of continuing with an answer that could imply success. Ordinary learning remains background work.
