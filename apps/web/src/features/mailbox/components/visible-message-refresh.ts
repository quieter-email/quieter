type CollectVisibleMessageRefreshBatchArgs = {
  cooldownMs: number;
  inFlightMessageIds: Set<string>;
  maxBatchSize: number;
  now: number;
  queuedMessageIds: Set<string>;
  recentAttemptByMessageId: Map<string, number>;
  skipMessageIds: ReadonlySet<string>;
};

export const queueVisibleMessageRefreshIds = (
  queuedMessageIds: Set<string>,
  messageIds: readonly string[],
  skipMessageIds: ReadonlySet<string>,
) => {
  let hasQueuedMessage = false;

  for (const messageId of messageIds) {
    if (skipMessageIds.has(messageId)) continue;
    queuedMessageIds.add(messageId);
    hasQueuedMessage = true;
  }

  return hasQueuedMessage;
};

export const collectVisibleMessageRefreshBatch = ({
  cooldownMs,
  inFlightMessageIds,
  maxBatchSize,
  now,
  queuedMessageIds,
  recentAttemptByMessageId,
  skipMessageIds,
}: CollectVisibleMessageRefreshBatchArgs) => {
  const messageIds: string[] = [];

  for (const [messageId, attemptedAt] of recentAttemptByMessageId) {
    if (now - attemptedAt > cooldownMs) {
      recentAttemptByMessageId.delete(messageId);
    }
  }

  for (const messageId of queuedMessageIds) {
    queuedMessageIds.delete(messageId);

    if (
      skipMessageIds.has(messageId) ||
      inFlightMessageIds.has(messageId) ||
      recentAttemptByMessageId.has(messageId)
    ) {
      continue;
    }

    messageIds.push(messageId);
    inFlightMessageIds.add(messageId);
    recentAttemptByMessageId.set(messageId, now);

    if (messageIds.length === maxBatchSize) break;
  }

  return messageIds;
};
