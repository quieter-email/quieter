import { db } from "@quieter/database/client";
import {
  mailObjectCleanup,
  managedMailMessage,
  organizationApiMailMessage,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { asc, eq, lte, sql } from "drizzle-orm";

import { LOCAL_MAIL_BUCKET } from "../local-storage";
import { deleteRawMailObject, writeRawMailObject } from "./raw-object";
import type { RawMailObjectReference } from "./raw-object";

const OBJECT_RECHECK_MS = 24 * 60 * 60 * 1000;

export const storeRawMailObject = async (
  raw: Uint8Array
): Promise<RawMailObjectReference> => {
  const bucket =
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local"
      ? LOCAL_MAIL_BUCKET
      : serverEnv.R2_BUCKET;
  if (bucket === undefined || bucket === "") {
    throw new Error("Raw mail storage is not configured.");
  }
  const object = {
    bucket,
    key: `messages/${crypto.randomUUID()}.eml`,
    provider: "r2" as const,
  };
  const now = new Date();
  await db.insert(mailObjectCleanup).values({
    ...object,
    createdAt: now,
    id: crypto.randomUUID(),
    notBefore: new Date(now.getTime() + OBJECT_RECHECK_MS),
  });
  await writeRawMailObject(object, raw);
  return object;
};

export const cleanupMailObjects = async (now = new Date()) => {
  const objects = await db
    .select()
    .from(mailObjectCleanup)
    .where(lte(mailObjectCleanup.notBefore, now))
    .orderBy(asc(mailObjectCleanup.notBefore))
    .limit(25);
  const results = await Promise.allSettled(
    objects.map(async (object) => {
      await db
        .update(mailObjectCleanup)
        .set({ notBefore: new Date(now.getTime() + OBJECT_RECHECK_MS) })
        .where(eq(mailObjectCleanup.id, object.id));
      const [references] = await db
        .select({
          tracked: sql<boolean>`
      exists(select 1 from ${managedMailMessage} where ${managedMailMessage.rawObjectProvider} = ${object.provider} and ${managedMailMessage.rawObjectBucket} = ${object.bucket} and ${managedMailMessage.rawObjectKey} = ${object.key})
      or exists(select 1 from ${organizationApiMailMessage} where ${organizationApiMailMessage.rawObjectProvider} = ${object.provider} and ${organizationApiMailMessage.rawObjectBucket} = ${object.bucket} and ${organizationApiMailMessage.rawObjectKey} = ${object.key})
      or exists(select 1 from ${organizationMailSendIdempotency} where ${organizationMailSendIdempotency.rawObjectProvider} = ${object.provider} and ${organizationMailSendIdempotency.rawObjectBucket} = ${object.bucket} and ${organizationMailSendIdempotency.rawObjectKey} = ${object.key})
    `,
        })
        .from(mailObjectCleanup)
        .where(eq(mailObjectCleanup.id, object.id));
      if (!references?.tracked) {
        await deleteRawMailObject(object);
        await db
          .delete(mailObjectCleanup)
          .where(eq(mailObjectCleanup.id, object.id));
      }
    })
  );
  for (const result of results) {
    if (result.status === "rejected") {
      reportError(result.reason, { operation: "managed-mail:object-cleanup" });
    }
  }
};
