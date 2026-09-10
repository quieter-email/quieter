import { createHash } from "node:crypto";

import { db } from "@quieter/database/client";
import { mailbox, mailDomain, member, user } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, asc, eq } from "drizzle-orm";

import { getLocalMailStorage, LOCAL_MAIL_BUCKET } from "./local-storage";
import { recordInboundManagedMessage } from "./messages/ingestion";

export const seedLocalManagedMail = async (ownerEmail: string) => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local") {
    throw new Error("Mail fixtures are only available in local development.");
  }
  const storage = getLocalMailStorage();
  const [owner] = await db
    .select({ organizationId: member.organizationId, userId: user.id })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(and(eq(user.email, ownerEmail), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);
  if (owner === undefined) {
    throw new Error(
      "Sign in locally first, then use that account's email address."
    );
  }
  const suffix = createHash("sha256")
    .update(`${owner.organizationId}:${owner.userId}`)
    .digest("hex")
    .slice(0, 16);
  const domain = `${suffix}.quieter.test`;
  const address = `fixtures@${domain}`;
  const mailboxId = `local-mailbox-${suffix}`;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(mailDomain)
      .values({
        createdAt: now,
        domain,
        id: `local-domain-${suffix}`,
        mailFromDomain: `bounce.${domain}`,
        mode: "send_and_receive",
        organizationId: owner.organizationId,
        requiredDnsRecords: [],
        status: "verified",
        updatedAt: now,
        verifiedAt: now,
      })
      .onConflictDoNothing();
    await tx
      .insert(mailbox)
      .values({
        accessMode: "private",
        createdAt: now,
        displayName: "Local mail fixtures",
        emailAddress: address,
        id: mailboxId,
        managedOwnerUserId: owner.userId,
        organizationId: owner.organizationId,
        provider: "managed",
        status: "connected",
        updatedAt: now,
      })
      .onConflictDoNothing();
  });
  const [fixtureMailbox] = await db
    .select()
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId))
    .limit(1);
  if (
    fixtureMailbox?.provider !== "managed" ||
    fixtureMailbox.accessMode !== "private" ||
    fixtureMailbox.managedOwnerUserId !== owner.userId ||
    fixtureMailbox.organizationId !== owner.organizationId ||
    fixtureMailbox.emailAddress !== address
  ) {
    throw new Error(
      "The existing fixture mailbox no longer matches this local account."
    );
  }
  const key = `fixtures/${suffix}/welcome-v1.eml`;
  const raw = new TextEncoder().encode(
    [
      "From: Local fixture <sender@example.test>",
      `To: ${address}`,
      "Subject: Local mail fixture with attachment",
      `Message-ID: <welcome-v1.${suffix}@quieter.test>`,
      "Date: Sat, 05 Sep 2026 12:00:00 +0000",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="quieter-local-fixture"',
      "",
      "--quieter-local-fixture",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "This message was created locally. It was never sent through an email provider.",
      "",
      "--quieter-local-fixture",
      'Content-Type: text/plain; name="local-note.txt"',
      'Content-Disposition: attachment; filename="local-note.txt"',
      "Content-Transfer-Encoding: base64",
      "",
      "TG9jYWwgYXR0YWNobWVudC4K",
      "--quieter-local-fixture--",
      "",
    ].join("\r\n")
  );
  await storage.put(key, raw);
  await recordInboundManagedMessage({
    providerMessageId: `local-welcome-v1-${suffix}`,
    rawMessage: raw,
    rawObjectBucket: LOCAL_MAIL_BUCKET,
    rawObjectKey: key,
    rawObjectProvider: "r2",
    rawSizeBytes: raw.byteLength,
    receivedAt: now,
    recipients: [address],
  });
  return {
    mailboxId,
    storage: "local",
    url: `http://localhost:3000/?mailboxId=${mailboxId}&mailbox=inbox&query=&view=inbox`,
  };
};
