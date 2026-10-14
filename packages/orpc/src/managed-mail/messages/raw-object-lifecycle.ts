import { db } from "@quieter/database/client";
import {
  mailObjectCleanup,
  managedMailMessage,
  organizationApiMailMessage,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { and, asc, eq, exists, lte, or } from "drizzle-orm";

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
      const [claimed] = await db
        .update(mailObjectCleanup)
        .set({ notBefore: new Date(now.getTime() + OBJECT_RECHECK_MS) })
        .where(
          and(
            eq(mailObjectCleanup.id, object.id),
            lte(mailObjectCleanup.notBefore, now)
          )
        )
        .returning({ id: mailObjectCleanup.id });
      if (claimed === undefined) {
        return;
      }
      const references = await db
        .select({ id: mailObjectCleanup.id })
        .from(mailObjectCleanup)
        .where(
          and(
            eq(mailObjectCleanup.id, object.id),
            or(
              exists(
                db
                  .select({ id: managedMailMessage.id })
                  .from(managedMailMessage)
                  .where(
                    or(
                      and(
                        eq(
                          managedMailMessage.rawObjectProvider,
                          object.provider
                        ),
                        eq(managedMailMessage.rawObjectBucket, object.bucket),
                        eq(managedMailMessage.rawObjectKey, object.key)
                      ),
                      object.provider === "s3"
                        ? and(
                            eq(managedMailMessage.s3Bucket, object.bucket),
                            eq(managedMailMessage.s3Key, object.key)
                          )
                        : undefined
                    )
                  )
              ),
              exists(
                db
                  .select({ id: organizationApiMailMessage.id })
                  .from(organizationApiMailMessage)
                  .where(
                    and(
                      eq(
                        organizationApiMailMessage.rawObjectProvider,
                        object.provider
                      ),
                      eq(
                        organizationApiMailMessage.rawObjectBucket,
                        object.bucket
                      ),
                      eq(organizationApiMailMessage.rawObjectKey, object.key)
                    )
                  )
              ),
              exists(
                db
                  .select({ id: organizationMailSendIdempotency.id })
                  .from(organizationMailSendIdempotency)
                  .where(
                    and(
                      eq(
                        organizationMailSendIdempotency.rawObjectProvider,
                        object.provider
                      ),
                      eq(
                        organizationMailSendIdempotency.rawObjectBucket,
                        object.bucket
                      ),
                      eq(
                        organizationMailSendIdempotency.rawObjectKey,
                        object.key
                      )
                    )
                  )
              )
            )
          )
        );
      if (references.length === 0) {
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
