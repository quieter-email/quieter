import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  gmailAutoLabelEvent,
  mailbox,
  mailAutoLabelFeedback,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database/schema";
import { listMessagesForAgent } from "@quieter/gmail";
import type {
  MailAutoLabelHistory,
  MailAutoLabelHistoryExample,
} from "@quieter/mail/auto-label";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";
import { and, desc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { assertAccessibleMailbox } from "../mailbox/service";

const EXAMPLE_LIMIT = 6;
const LABEL_LIMIT = 16;
const CORRECTION_LIMIT = 12;
const excludedGmailLabels = new Set<string>([
  MAILBOX_LABELS.sent,
  MAILBOX_LABELS.drafts,
  MAILBOX_LABELS.spam,
  MAILBOX_LABELS.trash,
]);

type HistorySource = {
  mailboxId: string;
  message: { id: string; from?: string | null };
  labels: { id: string; name: string }[];
} & (
  | { provider: "gmail"; accessToken: string; signal?: AbortSignal }
  | { provider: "managed" }
);
type HistoryInput = HistorySource & { userId: string };

type HistoryMessage = Pick<
  MailAutoLabelHistoryExample,
  "messageId" | "sender" | "subject" | "date"
> & { labelIds: string[] };

const listGmailHistory = async (
  input: Extract<HistorySource, { provider: "gmail" }>,
  sender: string,
  domain: string
) => {
  const quotedSender = sender.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const lanes = await Promise.all(
    [sender, `@${domain}`].map(async (queryValue, laneIndex) => {
      const matches = new Map<string, HistoryMessage>();
      let pageToken: string | undefined;
      for (let page = 0; page < 2; page += 1) {
        const quotedValue = queryValue
          .replaceAll("\\", "\\\\")
          .replaceAll('"', '\\"');
        const result = await listMessagesForAgent(input.accessToken, {
          maxResults: EXAMPLE_LIMIT * 3,
          pageToken,
          query: `from:"${quotedValue}"${laneIndex === 1 ? ` -from:"${quotedSender}"` : ""} -in:sent -in:drafts -in:spam -in:trash`,
          signal: input.signal,
        });
        for (const message of result.messages) {
          const source = extractMailAddress(message.from ?? "")
            .trim()
            .toLowerCase();
          if (
            message.id === input.message.id ||
            !z.email().safeParse(source).success ||
            message.labelIds?.some((id) => excludedGmailLabels.has(id)) ===
              true ||
            (laneIndex === 0
              ? source !== sender
              : source === sender || source.split("@")[1] !== domain)
          ) {
            continue;
          }
          matches.set(message.id, {
            date: message.date?.slice(0, 100),
            labelIds: message.labelIds ?? [],
            messageId: message.id,
            sender: source,
            subject: message.subject?.slice(0, 300),
          });
        }
        if (matches.size >= EXAMPLE_LIMIT || !result.nextPageToken) {
          break;
        }
        pageToken = result.nextPageToken;
      }
      return [...matches.values()].slice(0, EXAMPLE_LIMIT);
    })
  );
  return { sameDomain: lanes[1] ?? [], sameSender: lanes[0] ?? [] };
};

const listManagedHistory = async (
  input: Extract<HistorySource, { provider: "managed" }>,
  sender: string,
  domain: string
) => {
  // Match before applying the limit, including legacy rows whose normalized
  // search value was not populated. The mailbox index bounds both queries.
  const normalizedFrom = sql<string>`trim(regexp_replace(${managedMailMessage.from}, ${String.raw`\r?\n\s+`}, ' ', 'g'))`;
  const source = sql<string>`lower(trim(coalesce(substring(${normalizedFrom} from ${String.raw`^(?:"(?:[^"\\]|\\.)*"|[^<>"\r\n]*)\s*<([^<>]+)>$`}), ${normalizedFrom})))`;
  const lanes = await Promise.all(
    [
      eq(source, sender),
      and(ne(source, sender), eq(sql`split_part(${source}, '@', 2)`, domain)),
    ].map(
      async (senderMatch) =>
        await db
          .select({
            date: managedMailMessage.sentAt,
            messageId: managedMailMessage.id,
            sender: source,
            subject: managedMailMessage.subject,
          })
          .from(managedMailMessage)
          .where(
            and(
              eq(managedMailMessage.mailboxId, input.mailboxId),
              eq(managedMailMessage.direction, "inbound"),
              inArray(managedMailMessage.mailboxState, ["active", "archived"]),
              ne(managedMailMessage.id, input.message.id),
              senderMatch
            )
          )
          .orderBy(desc(managedMailMessage.sentAt), desc(managedMailMessage.id))
          .limit(EXAMPLE_LIMIT)
    )
  );
  const messages = lanes.map((lane) =>
    lane.flatMap((message): HistoryMessage[] =>
      z.email().safeParse(message.sender).success
        ? [
            {
              date: message.date.toISOString(),
              labelIds: [],
              messageId: message.messageId,
              sender: message.sender,
              subject: message.subject?.slice(0, 300),
            },
          ]
        : []
    )
  );
  return { sameDomain: messages[1] ?? [], sameSender: messages[0] ?? [] };
};

const enrichHistory = async (
  input: HistorySource,
  lanes: { sameSender: HistoryMessage[]; sameDomain: HistoryMessage[] }
): Promise<MailAutoLabelHistory> => {
  const messageIds = [...lanes.sameSender, ...lanes.sameDomain].map(
    (message) => message.messageId
  );
  const labels = new Map(
    input.labels.map((label) => [
      label.id,
      { id: label.id, name: label.name.slice(0, 200) },
    ])
  );
  const labelIds = [...labels.keys()];
  const rankedCorrections = db
    .select({
      labelId: mailAutoLabelFeedback.labelId,
      messageId: mailAutoLabelFeedback.providerMessageId,
      position:
        sql<number>`row_number() over (partition by ${mailAutoLabelFeedback.providerMessageId} order by ${mailAutoLabelFeedback.updatedAt} desc, ${mailAutoLabelFeedback.labelId})`.as(
          "position"
        ),
      recordedAt: mailAutoLabelFeedback.updatedAt,
      signal: mailAutoLabelFeedback.signal,
    })
    .from(mailAutoLabelFeedback)
    .where(
      and(
        eq(mailAutoLabelFeedback.mailboxId, input.mailboxId),
        eq(mailAutoLabelFeedback.provider, input.provider),
        inArray(mailAutoLabelFeedback.providerMessageId, messageIds),
        inArray(mailAutoLabelFeedback.labelId, labelIds)
      )
    )
    .as("ranked_history_corrections");
  const rankedAssignments = db
    .select({
      labelId: managedMailMessageLabel.labelId,
      messageId: managedMailMessageLabel.messageId,
      position:
        sql<number>`row_number() over (partition by ${managedMailMessageLabel.messageId} order by ${managedMailMessageLabel.createdAt} desc, ${managedMailMessageLabel.labelId})`.as(
          "position"
        ),
      source: managedMailMessageLabel.source,
    })
    .from(managedMailMessageLabel)
    .innerJoin(
      managedMailLabel,
      and(
        eq(managedMailLabel.id, managedMailMessageLabel.labelId),
        eq(managedMailLabel.mailboxId, input.mailboxId)
      )
    )
    .where(
      and(
        eq(managedMailMessageLabel.mailboxId, input.mailboxId),
        inArray(managedMailMessageLabel.messageId, messageIds),
        inArray(managedMailMessageLabel.labelId, labelIds)
      )
    )
    .as("ranked_history_assignments");
  const [events, corrections, assignments] = await Promise.all([
    db
      .select({
        appliedAt: gmailAutoLabelEvent.appliedAt,
        labelIds: gmailAutoLabelEvent.labelIds,
        messageId: gmailAutoLabelEvent.gmailMessageId,
      })
      .from(gmailAutoLabelEvent)
      .where(
        and(
          eq(gmailAutoLabelEvent.mailboxId, input.mailboxId),
          inArray(gmailAutoLabelEvent.gmailMessageId, messageIds),
          isNotNull(gmailAutoLabelEvent.appliedAt)
        )
      ),
    db
      .select()
      .from(rankedCorrections)
      .where(lte(rankedCorrections.position, CORRECTION_LIMIT)),
    input.provider === "managed"
      ? db
          .select()
          .from(rankedAssignments)
          .where(lte(rankedAssignments.position, LABEL_LIMIT))
      : [],
  ]);
  const enrich = (message: HistoryMessage): MailAutoLabelHistoryExample => {
    const event = events.find((row) => row.messageId === message.messageId);
    const currentLabels =
      input.provider === "managed"
        ? assignments.flatMap((assignment) => {
            const label = labels.get(assignment.labelId);
            return assignment.messageId === message.messageId && label
              ? [{ ...label, source: assignment.source }]
              : [];
          })
        : message.labelIds
            .flatMap((id) => {
              const label = labels.get(id);
              return label ? [label] : [];
            })
            .slice(0, LABEL_LIMIT);
    return {
      currentLabels,
      date: message.date,
      manualCorrections: corrections.flatMap((correction) => {
        const label = labels.get(correction.labelId);
        return correction.messageId === message.messageId && label
          ? [
              {
                labelId: label.id,
                labelName: label.name,
                recordedAt: correction.recordedAt.toISOString(),
                signal: correction.signal,
              },
            ]
          : [];
      }),
      messageId: message.messageId,
      priorAutomaticApplication: event?.appliedAt
        ? {
            appliedAt: event.appliedAt.toISOString(),
            labels: (event.labelIds ?? [])
              .flatMap((id) => {
                const label = labels.get(id);
                return label ? [label] : [];
              })
              .slice(0, LABEL_LIMIT),
          }
        : null,
      sender: message.sender,
      subject: message.subject,
    };
  };
  return {
    sameDomain: lanes.sameDomain.map(enrich),
    sameSender: lanes.sameSender.map(enrich),
  };
};

const loadHistory = async (
  input: HistorySource
): Promise<MailAutoLabelHistory | null> => {
  try {
    if (input.provider === "gmail") {
      input.signal?.throwIfAborted();
    }
    const sender = extractMailAddress(input.message.from ?? "")
      .trim()
      .toLowerCase();
    if (!z.email().safeParse(sender).success) {
      return null;
    }
    const [, domain] = sender.split("@");
    if (!domain || input.labels.length === 0) {
      return null;
    }
    const lanes =
      input.provider === "gmail"
        ? await listGmailHistory(input, sender, domain)
        : await listManagedHistory(input, sender, domain);
    if (input.provider === "gmail") {
      input.signal?.throwIfAborted();
    }
    if (lanes.sameSender.length === 0 && lanes.sameDomain.length === 0) {
      return null;
    }
    const history = await enrichHistory(input, lanes);
    if (input.provider === "gmail") {
      input.signal?.throwIfAborted();
    }
    return history;
  } catch (error) {
    if (input.provider === "gmail") {
      input.signal?.throwIfAborted();
    }
    if (
      error instanceof ORPCError &&
      (error.code === "FORBIDDEN" ||
        error.code === "NOT_FOUND" ||
        error.code === "UNAUTHORIZED")
    ) {
      throw error;
    }
    reportError(new Error("Mail label history could not be loaded."), {
      operation: "mail-automation:load-label-history",
      provider: input.provider,
    });
    return null;
  }
};

export const loadMailAutoLabelHistory = async (
  input: HistoryInput
): Promise<MailAutoLabelHistory | null> => {
  const access = await assertAccessibleMailbox(input);
  if (access.provider !== input.provider) {
    return null;
  }
  return await loadHistory(input);
};

export const loadManagedAutomationLabelHistory = async (
  input: Extract<HistorySource, { provider: "managed" }>
): Promise<MailAutoLabelHistory | null> => {
  const [target] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.provider, "managed"),
        eq(mailbox.status, "connected")
      )
    )
    .limit(1);
  return target === undefined ? null : await loadHistory(input);
};
