import type { SyncBody, SyncChange, SyncMessage } from "@quieter/sync";

import { MailboxReplica } from "../src/replica";
import { ReplicaStorage } from "../src/storage";
import type { SyncApi } from "../src/types";

export const runReplicaBrowserBenchmark = async (messageCount = 50_000) => {
  const userId = `benchmark-${crypto.randomUUID()}`;
  const mailboxId = "synthetic-archive";
  const epoch = crypto.randomUUID();
  const storage = await ReplicaStorage.open(userId);
  const body: SyncBody = {
    bodyHtml: `<article>${"<p>Synthetic archive content for local performance verification.</p>".repeat(2048)}</article>`,
    bodyText: "Synthetic archive content",
  };
  const payload = new TextEncoder().encode(JSON.stringify(body));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  const hash = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  let networkReads = 0;
  let measurements = 0;
  const unavailable = () => {
    networkReads += 1;
    throw new Error(
      "A prepared archive read unexpectedly required the server."
    );
  };
  const api: SyncApi = {
    body: unavailable,
    command: unavailable,
    connection: unavailable,
    hydrate: unavailable,
    replay: unavailable,
    snapshot: unavailable,
    submit: unavailable,
  };
  try {
    const start = performance.now();
    await storage.bootstrap({
      checkpoint: { epoch, sequence: "0" },
      coverage: { complete: true, kind: "working-set", threadIds: [] },
      entities: [],
      mailboxId,
    });
    for (let offset = 0; offset < messageCount; offset += 500) {
      const sequence = String(offset / 500 + 1);
      const changes: SyncChange[] = [];
      for (
        let index = offset;
        index < Math.min(offset + 500, messageCount);
        index += 1
      ) {
        const message: SyncMessage = {
          attachments: [],
          body: { bytes: payload.byteLength, hash },
          from: "Synthetic sender <sender@quieter.test>",
          id: `message-${index}`,
          internalDate: String(Date.UTC(2020, 0, 1) + index * 60_000),
          isUnread: index % 5 === 0,
          labelIds: index % 2 === 0 ? ["INBOX"] : [],
          snippet: "Synthetic archive content",
          subject: `Synthetic message ${index}`,
          threadId: `thread-${index}`,
        };
        changes.push(
          {
            data: { kind: "message", value: message },
            id: message.id,
            kind: "message",
            version: sequence,
          },
          {
            data: {
              kind: "thread",
              value: {
                attachmentCount: 0,
                id: message.threadId,
                isUnread: message.isUnread,
                labelIds: message.labelIds,
                latest: message,
                messageCount: 1,
                messageIds: [message.id],
              },
            },
            id: message.threadId,
            kind: "thread",
            version: sequence,
          }
        );
      }
      if (
        (await storage.apply({
          changes,
          epoch,
          mailboxId,
          protocol: 1,
          sequence,
        })) !== "apply"
      ) {
        throw new Error("Synthetic archive checkpoint did not advance.");
      }
      Reflect.set(
        globalThis,
        "syncBenchmarkProgress",
        Math.min(offset + 500, messageCount)
      );
    }
    await storage.putBody(mailboxId, hash, body);
    const importMs = performance.now() - start;
    const bodyCache = new Map<string, SyncBody>();
    const replica = new MailboxReplica({
      api,
      bodyCache,
      mailboxId,
      notify: (event) => {
        if (event.type === "measurement") {
          measurements += 1;
        }
      },
      signal: new AbortController().signal,
      storage,
    });
    const loadStart = performance.now();
    await replica.load();
    const restoreMs = performance.now() - loadStart;
    const coldStart = performance.now();
    await replica.thread("thread-0");
    const persistedBodyReadMs = performance.now() - coldStart;
    const samples: number[] = [];
    for (let index = 0; index < 1000; index += 1) {
      const readStart = performance.now();
      const thread = await replica.thread(
        `thread-${(index * 7919) % messageCount}`
      );
      samples.push(performance.now() - readStart);
      if (thread.messages[0]?.bodyHtml !== body.bodyHtml) {
        throw new Error("The synthetic archive lost a body.");
      }
    }
    samples.sort((left, right) => left - right);
    const budgetStart = performance.now();
    const original = await storage.enforceBudget(200 * 1024 * 1024);
    const budgetMs = performance.now() - budgetStart;
    const evicted = await storage.enforceBudget(
      10 * 1024 * 1024,
      new Set([`${mailboxId}:${hash}`]),
      new Set([`${mailboxId}:thread-0`])
    );
    if (
      evicted.used > 10 * 1024 * 1024 ||
      (await storage.body(mailboxId, hash)) === null
    ) {
      throw new Error(
        "Cache eviction did not preserve the pinned body within budget."
      );
    }
    return {
      bodyBytes: payload.byteLength,
      budgetMs,
      cacheBytes: original.used,
      evictedThreads: evicted.evictedThreads.length,
      importMs,
      measurements,
      memoryReadP50Ms: samples[500],
      memoryReadP99Ms: samples[990],
      messageCount,
      networkReads,
      persistedBodyReadMs,
      restoreMs,
    };
  } finally {
    await storage.shutdownAndPurge();
  }
};
