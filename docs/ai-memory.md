# Ambient AI memory

Quieter maintains one background memory pipeline for every behavior-producing AI agent. The product does not expose stored records, internal scopes, writer prompts, or change history. A user can ask the chat agent what it knows, tell it to remember or forget something, correct it naturally, pause adaptation, or reset personal context.

## Pipeline

Memory moves through these stages:

1. High-signal activity is captured as a compact `userAiContextEvent`. Sent-message observations contain behavioral features, not raw bodies.
2. The memory writer consolidates observations into atomic, conflict-aware `aiMemory` records. Records carry evidence source, confidence, importance, reinforcement, applicability, provenance, expiry, and version.
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

Personal memory belongs to one user, follows them across mailboxes, and stays private. Mailbox memory belongs to one mailbox and is available only through normal mailbox access. Writes to shared mailbox context require the knowledge-management capability. Every vector is partitioned into the same user or mailbox namespace as its source record.

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

## Active and passive knowledge

Active learning is appropriate for reusable signals such as sending or replying, explicit memory requests, repeated corrections, useful-detail ratings, and material mailbox actions. Passive lookup is used for current, exhaustive, or auditable questions such as unread state, recent recipients, or the present contents of a thread.

Every personal and mailbox context has internal learning guidance and an adaptation flag. Settings exposes only the personal adaptation flag and a reset action. Detailed control happens conversationally in chat.

## Agent integration contract

All contextual agents call `loadAiAgentContext` from `packages/orpc/src/ai-memory.ts` with a stable agent slug, an accessible mailbox, the acting user, and a task-specific query. `serializeAiAgentContext` is used when an AI package expects one prompt field.

Interactive agents can receive personal and mailbox context. Background agents without an acting user receive mailbox context only. Administrative model calls and strict evidence-only extractors do not receive memory. New agents that draft, classify, prioritize, route, summarize for action, or perform external actions must integrate the central loader.

The chat `memory` tool is the only inspection and editing interface. It can summarize personal and current-mailbox context or apply an explicit correction, remembrance, or forgetting request. The model chooses the internal scope from the user's intent without asking the user to manage the storage model.

Memory writes carry provenance. The tool passes the acting user's verbatim message alongside the agent's restatement of it, and the writer treats only the user's own words as evidence of intent. A restatement that claims durable intent the user did not express produces no operation, and content an agent read from mail, attachments, or connectors can never create or change a record. This is a structural boundary rather than a keyword filter, so ordinary phrasing such as "from now on, sign off with Cheers" is captured while an instruction embedded in a message is not.

## Reliability and deletion

Model failures produce no partial memory mutation. Concurrent writes use record versions. An embedding is written only while the record's `updatedAt` is unchanged, so an embedding computed from superseded content is discarded rather than attached to newer text.

Resetting personal context removes records, history, and personal learning observations in one transaction. Mailbox deletion additionally removes feedback and legacy automation profiles. Because embeddings are columns on the records themselves, deletion is immediate and complete with no second system to reconcile.
