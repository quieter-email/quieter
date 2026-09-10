import { db } from "@quieter/database/client";
import { syncIdSchema } from "@quieter/sync";
import { collectSyncBodies } from "@quieter/sync-server/body-collection";
import { z } from "zod";

export const maintainSyncBodies = async (bucket: R2Bucket) => {
  const saved = await bucket.get("sync/maintenance/body-cursor");
  const cursor =
    saved === null
      ? undefined
      : z.object({ cursor: z.string().optional() }).parse(await saved.json())
          .cursor;
  const page = await bucket.list({
    cursor,
    limit: 100,
    prefix: "sync/bodies/",
  });
  const candidates = page.objects.flatMap((object) => {
    const match =
      /^sync\/bodies\/(?<mailbox>[^/]+)\/(?<hash>[a-f0-9]{64})$/u.exec(
        object.key
      );
    if (match === null) {
      return [];
    }
    const mailboxId = syncIdSchema.parse(decodeURIComponent(match[1]));
    return [{ hash: match[2], mailboxId, uploaded: object.uploaded }];
  });
  const result = await collectSyncBodies(
    db,
    {
      delete: async (key) => {
        await bucket.delete(key);
      },
    },
    candidates
  );
  await bucket.put(
    "sync/maintenance/body-cursor",
    JSON.stringify({ cursor: page.truncated ? page.cursor : undefined })
  );
  return result;
};
