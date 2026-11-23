import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import { assertLocalDatabaseUrl } from "@quieter/database/local-development";
import {
  gmailCapturedMessage,
  mailObjectCleanup,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { LOCAL_MAIL_BUCKET } from "./managed-mail/local-storage";
import {
  readMailObject,
  writeRawMailObject,
} from "./managed-mail/messages/raw-object";

const BODY_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const STAGING_MS = 24 * 60 * 60 * 1000;
const bodySchema = z.object({
  bodyHtml: z.string().nullable(),
  bodyText: z.string().nullable(),
});

type CapturedRow = typeof gmailCapturedMessage.$inferSelect;
type BodyObject = NonNullable<CapturedRow["bodyObject"]>;
type BodyOwner = Pick<CapturedRow, "mailboxId" | "messageId">;

const bodyEncryptionKey = (requestedVersion?: string) => {
  for (const candidate of serverEnv.GMAIL_BODY_ENCRYPTION_KEY?.split(",") ??
    []) {
    if (!/^[\da-f]{64}$/iu.test(candidate)) {
      throw new Error("Gmail body encryption keys must be 32-byte hex values.");
    }
    const key = Buffer.from(candidate, "hex");
    const version = createHash("sha256").update(key).digest("hex");
    if (requestedVersion === undefined || requestedVersion === version) {
      return { key, version };
    }
  }
  throw new Error("The required Gmail body encryption key is unavailable.");
};

const bodyContext = (owner: BodyOwner, object: BodyObject) =>
  Buffer.from(
    JSON.stringify([
      "gmail-captured-body",
      BODY_VERSION,
      owner.mailboxId,
      owner.messageId,
      object.revision,
      object.bucket,
      object.key,
      object.keyVersion,
      object.htmlDigest,
    ])
  );

export const gmailCapturedBodyText = sql`coalesce(${gmailCapturedMessage.bodySearchText}, ${gmailCapturedMessage.snapshot}->>'bodyText')`;
export const gmailCapturedSearchDocument = sql`coalesce(case when ${gmailCapturedMessage.bodySearchDocument} is null then gmail_capture_search_full(${gmailCapturedMessage.snapshot}) else (${gmailCapturedMessage.bodySearchDocument})[1] end, ''::tsvector)`;

export const hydrateGmailCapturedSnapshot = async (
  row: Pick<CapturedRow, "bodyObject" | "mailboxId" | "messageId" | "snapshot">
): Promise<CapturedMailSnapshot | null> => {
  if (row.snapshot === null) {
    return null;
  }
  const object = row.bodyObject;
  if (object === null) {
    return {
      ...row.snapshot,
      bodyHtml: row.snapshot.bodyHtml ?? null,
      bodyText: row.snapshot.bodyText ?? null,
    };
  }
  const { key } = bodyEncryptionKey(object.keyVersion);
  const stored = await readMailObject({ ...object, provider: "r2" });
  const tagStart = 1 + IV_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  if (stored[0] !== BODY_VERSION || stored.length <= ciphertextStart) {
    throw new Error("Stored Gmail body envelope is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    stored.subarray(1, tagStart),
    {
      authTagLength: TAG_BYTES,
    }
  );
  decipher.setAAD(bodyContext(row, object));
  decipher.setAuthTag(stored.subarray(tagStart, ciphertextStart));
  const plaintext = Buffer.concat([
    decipher.update(stored.subarray(ciphertextStart)),
    decipher.final(),
  ]);
  return {
    ...row.snapshot,
    ...bodySchema.parse(JSON.parse(plaintext.toString("utf-8"))),
  };
};

export const stageGmailCapturedBody = async (
  owner: BodyOwner,
  snapshot: CapturedMailSnapshot
) => {
  const { key, version } = bodyEncryptionKey();
  const local = serverEnv.QUIETER_DEPLOYMENT_ENV === "local";
  if (local) {
    assertLocalDatabaseUrl(serverEnv.DATABASE_URL ?? "postgres://unconfigured");
  }
  const bucket = local ? LOCAL_MAIL_BUCKET : serverEnv.R2_BUCKET;
  if (!bucket) {
    throw new Error("Gmail body storage is missing its R2 bucket.");
  }
  const { bodyHtml, bodyText, ...metadata } = snapshot;
  const id = randomUUID();
  const bodyObject = {
    bucket,
    htmlDigest:
      bodyHtml === null
        ? null
        : createHash("sha256")
            .update(Buffer.from(bodyHtml, "utf-8"))
            .digest("hex"),
    key: `gmail-bodies/${id}`,
    keyVersion: version,
    revision: snapshot.providerRevision,
  };
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(bodyContext(owner, bodyObject));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify({ bodyHtml, bodyText }), "utf-8")),
    cipher.final(),
  ]);
  const createdAt = new Date();
  const notBefore = new Date(createdAt.getTime() + STAGING_MS);
  await db.insert(mailObjectCleanup).values({
    bucket,
    createdAt,
    id,
    key: bodyObject.key,
    notBefore,
    provider: "r2",
  });
  await writeRawMailObject(
    { ...bodyObject, provider: "r2" },
    Buffer.concat([
      Buffer.from([BODY_VERSION]),
      iv,
      cipher.getAuthTag(),
      ciphertext,
    ]),
    "application/octet-stream"
  );
  return {
    columns: {
      bodyObject,
      bodySearchDocument: sql`gmail_capture_search_document(${JSON.stringify(snapshot)}::text::jsonb)`,
      bodySearchText: bodyText,
      snapshot: metadata,
    },
    id,
    notBefore,
  };
};

export const finishGmailCapturedBody = async (
  tx: DatabaseTransaction,
  staged: Awaited<ReturnType<typeof stageGmailCapturedBody>>
) => {
  // Once cleanup claims an expired marker it can delete the object. Require the
  // original, unexpired marker and hold its lock until the pointer commits.
  const [marker] = await tx
    .delete(mailObjectCleanup)
    .where(
      and(
        eq(mailObjectCleanup.id, staged.id),
        eq(mailObjectCleanup.notBefore, staged.notBefore),
        gt(mailObjectCleanup.notBefore, sql`timezone('UTC', clock_timestamp())`)
      )
    )
    .returning({ id: mailObjectCleanup.id });
  if (marker === undefined) {
    throw new Error("The staged Gmail body expired before publication.");
  }
};
