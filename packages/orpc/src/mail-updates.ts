import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxGrant,
  mailboxDivisionGrant,
  organizationDivision,
  organizationDivisionMember,
  member,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { mailConnectionSchema, signMailPayload } from "@quieter/mail/updates";
import type { MailUpdate } from "@quieter/mail/updates";
import { reportError } from "@quieter/observability";
import { and, eq, isNull } from "drizzle-orm";

export const listMailUpdateRecipients = async (mailboxId: string) => {
  const [selected] = await db
    .select()
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId))
    .limit(1);
  if (selected === undefined) {
    return [];
  }
  if (selected.provider === "gmail") {
    return selected.status === "connected" && selected.ownerUserId
      ? [selected.ownerUserId]
      : [];
  }
  if (selected.provider !== "managed") {
    return [];
  }
  const [direct, division, owners] = await Promise.all([
    db
      .select({ userId: member.userId })
      .from(mailboxGrant)
      .innerJoin(
        member,
        and(
          eq(member.userId, mailboxGrant.userId),
          eq(member.organizationId, selected.organizationId)
        )
      )
      .where(eq(mailboxGrant.mailboxId, mailboxId)),
    db
      .select({ userId: member.userId })
      .from(mailboxDivisionGrant)
      .innerJoin(mailbox, eq(mailbox.id, mailboxDivisionGrant.mailboxId))
      .innerJoin(
        organizationDivision,
        eq(organizationDivision.id, mailboxDivisionGrant.divisionId)
      )
      .innerJoin(
        organizationDivisionMember,
        eq(organizationDivisionMember.divisionId, organizationDivision.id)
      )
      .innerJoin(member, eq(member.id, organizationDivisionMember.memberId))
      .where(
        and(
          eq(mailbox.id, mailboxId),
          isNull(mailbox.managedOwnerUserId),
          eq(member.organizationId, selected.organizationId),
          eq(organizationDivision.organizationId, selected.organizationId)
        )
      ),
    selected.managedOwnerUserId
      ? db
          .select({ userId: member.userId })
          .from(member)
          .where(
            and(
              eq(member.userId, selected.managedOwnerUserId),
              eq(member.organizationId, selected.organizationId)
            )
          )
      : Promise.resolve([]),
  ]);
  return [
    ...new Set([...direct, ...division, ...owners].map((row) => row.userId)),
  ];
};

export const createMailUpdateConnection = async (userId: string) => {
  const base = serverEnv.MAIL_UPDATES_URL ?? serverEnv.GMAIL_LIVE_SYNC_URL;
  const secret = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  if (!base || !secret) {
    return { url: null };
  }
  const url = new URL(base);
  url.pathname = "/mail/live";
  const payload = JSON.stringify(
    mailConnectionSchema.parse({
      expiresAt: Date.now() + 90_000,
      purpose: "mail-connection",
      userId,
    })
  );
  url.search = "";
  url.searchParams.set("ticket", payload);
  url.searchParams.set("signature", await signMailPayload(payload, secret));
  return { url: url.toString() };
};

// Delivery is a hint. A committed mail operation remains successful if broadcasting fails.
export const publishMailUpdate = async (input: Omit<MailUpdate, "eventId">) => {
  const base = serverEnv.MAIL_UPDATES_URL ?? serverEnv.GMAIL_LIVE_SYNC_URL;
  const secret = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  if (!base || !secret) {
    return;
  }
  try {
    const url = new URL(base);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/mail/events";
    url.search = "";
    const body = JSON.stringify({
      event: { ...input, eventId: crypto.randomUUID() },
      expiresAt: Date.now() + 30_000,
      purpose: "mail-event",
    });
    const response = await fetch(url, {
      body,
      headers: {
        "content-type": "application/json",
        "x-mail-signature": await signMailPayload(body, secret),
      },
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error("Mail update delivery failed.");
    }
  } catch (error) {
    reportError(error, { boundary: "mail-updates" });
  }
};

export const findGmailUpdateMailboxIds = async (emailAddress: string) =>
  await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.emailAddress, emailAddress.trim().toLowerCase()),
        eq(mailbox.provider, "gmail"),
        eq(mailbox.status, "connected")
      )
    );

export const withMailUpdate =
  <TInput extends { mailboxId: string }, TContext, TResult>(
    handler: (options: {
      input: TInput;
      context: TContext;
    }) => Promise<TResult>,
    type: MailUpdate["type"] = "mailbox.changed"
  ) =>
  async (options: { input: TInput; context: TContext }) => {
    const result = await handler(options);
    await publishMailUpdate({ mailboxId: options.input.mailboxId, type });
    return result;
  };
