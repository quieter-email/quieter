import { createHash } from "node:crypto";

import { db } from "@quieter/database/client";
import { aiGeneratedMailBody } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { convert } from "html-to-text";

type MailBody = {
  bodyHtml?: string;
  bodyText?: string;
};

const GENERATED_MAIL_RETENTION_MS = 90 * 24 * 60 * 60_000;

export const extractAuthoredMailText = (message: MailBody) => {
  const body = message.bodyHtml?.trim()
    ? convert(message.bodyHtml, {
        selectors: [
          { options: { ignoreHref: true }, selector: "a" },
          { format: "skip", selector: "blockquote" },
          { format: "skip", selector: ".gmail_quote" },
          { format: "skip", selector: ".gmail_attr" },
          { format: "skip", selector: ".yahoo_quoted" },
          { format: "skip", selector: "#divRplyFwdMsg" },
          { format: "skip", selector: "[data-quieter-signature]" },
          { format: "skip", selector: "img" },
        ],
        wordwrap: false,
      })
    : (message.bodyText ?? "");
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const authored: string[] = [];
  for (const line of lines) {
    if (
      /^\s*(?:[-_]{3,}\s*(?:original|forwarded|weitergeleitete|ursprüngliche|message d'origine)|begin forwarded message\s*:|on .{1,500}wrote\s*:|am .{1,500}schrieb .{0,200}:|le .{1,500}écrit\s*:|el .{1,500}escribió\s*:)/iu.test(
        line
      ) ||
      /^\s*(?:from|von|de)\s*:.+@/iu.test(line)
    ) {
      break;
    }
    if (!/^\s*>/u.test(line)) {
      authored.push(line);
    }
  }
  return authored.join("\n").trim();
};

export const recordAiGeneratedMailBody = async (
  input: MailBody & { mailboxId: string; userId: string }
) => {
  const text = extractAuthoredMailText(input).replaceAll(/\s+/gu, " ").trim();
  if (!text) {
    return;
  }
  const now = new Date();
  try {
    await db
      .insert(aiGeneratedMailBody)
      .values({
        bodyDigest: createHash("sha256").update(text).digest("hex"),
        createdAt: now,
        expiresAt: new Date(now.getTime() + GENERATED_MAIL_RETENTION_MS),
        mailboxId: input.mailboxId,
        userId: input.userId,
      })
      .onConflictDoUpdate({
        set: {
          expiresAt: new Date(now.getTime() + GENERATED_MAIL_RETENTION_MS),
        },
        target: [
          aiGeneratedMailBody.mailboxId,
          aiGeneratedMailBody.userId,
          aiGeneratedMailBody.bodyDigest,
        ],
      });
  } catch {
    const error = new Error("Generated mail provenance could not be recorded.");
    reportError(error, { operation: "ai-memory:record-mail-authorship" });
    throw error;
  }
};

export const isAiGeneratedMailBody = async (
  input: MailBody & {
    mailboxId: string;
    signatureHtml?: string | null;
    signatureText?: string | null;
  }
) => {
  const text = extractAuthoredMailText(input).replaceAll(/\s+/gu, " ").trim();
  if (!text) {
    return false;
  }
  const digests = new Set([createHash("sha256").update(text).digest("hex")]);
  const signatures = [
    input.signatureText,
    input.signatureHtml
      ? extractAuthoredMailText({ bodyHtml: input.signatureHtml })
      : null,
  ];
  for (const signature of signatures) {
    const normalized = signature?.replaceAll(/\s+/gu, " ").trim();
    if (normalized && text.endsWith(` ${normalized}`)) {
      digests.add(
        createHash("sha256")
          .update(text.slice(0, -normalized.length).trimEnd())
          .digest("hex")
      );
    }
  }
  const [match] = await db
    .select({ bodyDigest: aiGeneratedMailBody.bodyDigest })
    .from(aiGeneratedMailBody)
    .where(
      and(
        eq(aiGeneratedMailBody.mailboxId, input.mailboxId),
        inArray(aiGeneratedMailBody.bodyDigest, [...digests]),
        gt(aiGeneratedMailBody.expiresAt, new Date())
      )
    )
    .limit(1);
  return match !== undefined;
};

export const purgeExpiredAiGeneratedMailBodies = async () => {
  await db
    .delete(aiGeneratedMailBody)
    .where(lt(aiGeneratedMailBody.expiresAt, new Date()));
};
