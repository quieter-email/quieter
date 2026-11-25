import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  managedMailMessage,
} from "@quieter/database/schema";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { getHistoryCorrespondents } from "@quieter/mail/correspondent-history";
import { decodeMimeHeaderValue } from "@quieter/mail/message-content";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { MailRequestContext } from "../gmail-request";
import { assertAccessibleMailbox } from "../mailbox/service";
import type { MailInputs } from "./inputs";

const RECENT_MESSAGE_LIMIT = 250;
const SUGGESTION_LIMIT = 8;
const gmailLabels = sql`${gmailCapturedMessage.snapshot}->'labelIds'`;

const readRecentGmailAddresses = async (mailboxId: string) => {
  const messages = await db
    .select({
      headers: sql<
        CapturedMailSnapshot["headers"]
      >`coalesce(jsonb_path_query_array(${gmailCapturedMessage.snapshot}->'headers', '$[*] ? (@.name like_regex "^(from|to|cc)$" flag "i")'), '[]'::jsonb)`,
      sent: sql<boolean>`(${gmailLabels}) ? 'SENT'`,
    })
    .from(gmailCapturedMessage)
    .where(
      and(
        eq(gmailCapturedMessage.mailboxId, mailboxId),
        isNull(gmailCapturedMessage.deletedAt),
        sql`jsonb_typeof(${gmailLabels}) = 'array'`,
        sql`not ((${gmailLabels}) ?| array['DRAFT', 'SPAM', 'TRASH'])`
      )
    )
    .orderBy(
      desc(gmailCapturedMessage.capturedAt),
      desc(gmailCapturedMessage.messageId)
    )
    .limit(RECENT_MESSAGE_LIMIT);

  return messages.map(({ headers, sent }) => {
    const values = new Map(
      headers.map(({ name, value }) => [name.toLowerCase(), value])
    );
    return {
      cc: sent ? decodeMimeHeaderValue(values.get("cc")) : undefined,
      from: sent ? "" : (decodeMimeHeaderValue(values.get("from")) ?? ""),
      to: sent ? decodeMimeHeaderValue(values.get("to")) : undefined,
    };
  });
};

const readRecentManagedAddresses = async (mailboxId: string) => {
  const messages = await db
    .select({
      cc: managedMailMessage.cc,
      direction: managedMailMessage.direction,
      from: managedMailMessage.from,
      to: managedMailMessage.to,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, mailboxId),
        inArray(managedMailMessage.mailboxState, ["active", "done"])
      )
    )
    .orderBy(desc(managedMailMessage.sentAt), desc(managedMailMessage.id))
    .limit(RECENT_MESSAGE_LIMIT);

  return messages.map((message) =>
    message.direction === "inbound"
      ? { from: message.from }
      : {
          cc: message.cc ?? undefined,
          from: "",
          to: message.to ?? undefined,
        }
  );
};

export const listRecipientSuggestions = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: MailInputs["listRecipientSuggestions"];
}) => {
  const access = { mailboxId: input.mailboxId, userId: context.userId };
  context.signal?.throwIfAborted();
  const selected = await assertAccessibleMailbox(access);
  if (!selected.capabilities.canSend) {
    throw new ORPCError("FORBIDDEN", {
      message: "You cannot send from this mailbox.",
    });
  }
  context.signal?.throwIfAborted();
  const recentAddresses =
    selected.provider === "managed"
      ? await readRecentManagedAddresses(input.mailboxId)
      : await readRecentGmailAddresses(input.mailboxId);
  context.signal?.throwIfAborted();
  const current = await assertAccessibleMailbox(access);
  if (!current.capabilities.canSend) {
    throw new ORPCError("FORBIDDEN", {
      message: "You cannot send from this mailbox.",
    });
  }
  context.signal?.throwIfAborted();

  const query = input.query.toLowerCase();
  const correspondents = getHistoryCorrespondents(recentAddresses);
  const prefixMatches: typeof correspondents = [];
  const otherMatches: typeof correspondents = [];
  for (const contact of correspondents) {
    const name = contact.name?.toLowerCase() ?? "";
    if (contact.email.startsWith(query) || name.startsWith(query)) {
      prefixMatches.push(contact);
    } else if (contact.email.includes(query) || name.includes(query)) {
      otherMatches.push(contact);
    }
  }
  return [...prefixMatches, ...otherMatches].slice(0, SUGGESTION_LIMIT);
};
