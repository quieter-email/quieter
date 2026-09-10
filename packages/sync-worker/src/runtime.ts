import { withRequestDatabaseClient } from "@quieter/database/client";
import { withMailSyncRuntime } from "@quieter/orpc/mail-sync";

export const withSyncRuntime = async <Result>(
  env: SyncEnv,
  run: () => Promise<Result>
) =>
  await withRequestDatabaseClient(
    async () =>
      await withMailSyncRuntime(
        {
          bodies: {
            delete: async (key) => {
              await env.SyncBodies.delete(key);
            },
            get: async (key) => {
              const object = await env.SyncBodies.get(key);
              return object === null
                ? null
                : new Uint8Array(await object.arrayBuffer());
            },
            has: async (key) => (await env.SyncBodies.head(key)) !== null,
            put: async (key, bytes) => {
              await env.SyncBodies.put(key, bytes);
            },
          },
          deliver: async (batch) => {
            await env.MailboxSyncObjects.getByName(batch.mailboxId).publish(
              batch
            );
          },
          enqueue: async (mailboxId) => {
            await env.MailboxSyncObjects.getByName(mailboxId).wake(mailboxId);
          },
        },
        run
      )
  );

export const readSyncRequest = async (request: Request, maxBytes: number) => {
  if (request.body === null) {
    throw new Error("Request body is missing.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      const value: unknown = next.value;
      if (!(value instanceof Uint8Array)) {
        throw new Error("Invalid request stream.");
      }
      size += value.byteLength;
      if (size > maxBytes) {
        throw new Error("Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};
