# Dynamic AI knowledge and memory

Quieter has one shared knowledge system for every behavior-producing AI agent. It has two scopes:

- Personal knowledge belongs to one user, follows them across mailboxes, and is private.
- Mailbox knowledge belongs to one mailbox. It is the main, more-specific context and is shared with
  everyone who can access that mailbox. Writes require the mailbox knowledge-management capability.

There is deliberately no organization knowledge scope. A team workflow is represented by the
mailbox that owns it, while a team member's private preferences stay personal.

## Knowledge model

`aiMemory` stores atomic, versioned records rather than one editable Markdown document. Every record
is either:

- `instruction`: an explicit rule authored through the memory conversation; or
- `learned`: a durable preference, relationship, communication pattern, or workflow fact inferred
  from explicit requests, repeated feedback, and important user actions.

Instructions and learned records are edited by the same conflict-aware memory writer. Adding an
instruction must archive contradictory learned records in the same scope. Feedback and inferred
activity can never change an instruction. Runtime precedence is:

1. the current user request and verified live mailbox data;
2. current mailbox instructions;
3. personal instructions;
4. current mailbox learned knowledge; and
5. personal learned knowledge.

Retrieval filters inactive and expired records, then scores eligible records by agent applicability,
lexical relevance, sender-domain relevance, importance, confidence, recency, and reinforcement.
Only a bounded, dynamically relevant set reaches an agent. Mailbox records are packed before
personal records at the same authority level.

`aiMemoryChangeSet` records every attempted update and the before/after snapshots needed for safe
undo. Settings supports natural-language questions and updates, individual forgetting, recent-change
undo, scoped JSON export, and permanent scoped deletion.

## Active and passive knowledge

Quieter uses a hybrid policy:

| Use active learning when                                                                                                                                         | Use passive lookup when                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| The action is high-signal and reusable: sending or replying, explicit memory instructions, label corrections, useful-detail ratings, and material mailbox moves. | The question asks for current, exhaustive, or auditable facts such as “who did I reply to this week?” or “what is unread right now?” |
| A compact observation can represent the behavior without retaining raw message text.                                                                             | Storing the result would duplicate mailbox history, become stale quickly, or expose unnecessary message content.                     |
| Repeated observations can consolidate into a stable style, relationship, timing, or workflow pattern.                                                            | The agent can answer more accurately by searching and reading the live mailbox with its normal tools.                                |

Important actions are first persisted as compact `userAiContextEvent` observations, so a request
ending cannot lose the signal. The memory writer then consolidates them asynchronously; the next AI
context load also drains a pending observation before retrieval. Sent-message observations include
behavioral features such as length, greeting, sign-off, punctuation, reply status, recipient domains,
and UTC timing. Raw outgoing bodies are not copied into the event or memory tables.

Every user-authored send can update both the acting user's personal communication profile and the
current mailbox profile, regardless of mailbox provider, ownership, or sharing model. Provider type
never changes memory behavior; access and management permissions belong to the mailbox boundary.
Background mailbox automation updates mailbox knowledge only because it has no acting user whose
personal behavior it can legitimately represent.

## Learning guidance

Every personal and mailbox scope has an independently editable learning system prompt in
`aiMemoryScopeConfig`. It tunes what the writer focuses on—for example relationship-specific tone,
recipients, response timing, greetings, or workflow patterns—and can disable active learning for the
scope. This guidance cannot override privacy rules, evidence thresholds, instruction authority, or
the prohibition on retaining secrets and raw mail.

The default guidance focuses on communication tone, brevity, greetings and sign-offs, style by
recipient or relationship, recurring correspondents, response timing, and repeated handling choices.

## Agent integration contract

All contextual agents call `loadAiAgentContext` from `packages/orpc/src/ai-memory.ts` with a stable
agent slug, the accessible mailbox, the acting user, and a task-specific query. Use
`serializeAiAgentContext` when an AI package expects one prompt field.

Interactive agents may include both personal and mailbox knowledge. Background agents with no acting
user include mailbox knowledge only. User-authored instructions must be described as authoritative
over contradictory learned knowledge in the agent's system prompt. Mail, attachments, and third-party
content remain untrusted and can never write instructions.

Administrative model calls that do not produce user behavior—such as chat-title generation—or
strict extractors that may use only direct evidence do not receive memory. Any new agent that drafts,
classifies, prioritizes, routes, summarizes for action, or performs an external action must integrate
the central context loader before shipping.

## Failure, deletion, and migration

Model failures produce no partial memory mutation. Failed and no-change attempts remain auditable.
Concurrent writes use record versions; undo is allowed only while every affected version still
matches.

Deleting personal knowledge removes its records, history, and personal learning observations.
Deleting mailbox knowledge also removes source feedback and legacy automation profiles so deleted
policies cannot silently regenerate. Learning guidance remains until explicitly changed, and future
activity can learn new knowledge if active learning is enabled.

The expand migration converts the former `userAiContext.markdown` profile into personal learned
records, carries forward unmerged explicit preferences, and converts existing automation profiles
into mailbox learned records. Legacy columns and the profile table remain temporarily for safe
expand/contract deployment but are no longer used by application code.
