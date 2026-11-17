export type PlacementMessage = {
  id: string;
  threadId: string;
  receivedAt: number;
  placement: "inbox" | "done" | "protected";
};

export const resolvePlacementTargets = (input: {
  messages: PlacementMessage[];
  placement: "done" | "inbox";
  threadId: string;
  requestedMessageIds: string[];
}): { messageIds: string[]; intentMessageIds: string[] } | null => {
  const messages = input.messages.toSorted(
    (left, right) =>
      left.receivedAt - right.receivedAt || left.id.localeCompare(right.id)
  );
  const requestedIds = new Set(input.requestedMessageIds);
  if (
    requestedIds.size === 0 ||
    ![...requestedIds].every((id) =>
      messages.some(
        (message) => message.id === id && message.threadId === input.threadId
      )
    )
  ) {
    return null;
  }
  const lastAnchorIndex = messages.findLastIndex((message) =>
    requestedIds.has(message.id)
  );
  const sourcePlacement = input.placement === "done" ? "inbox" : "done";
  const prefix = messages
    .slice(0, lastAnchorIndex + 1)
    .filter(
      (message) =>
        message.threadId === input.threadId && message.placement !== "protected"
    );
  return {
    intentMessageIds: prefix.map((message) => message.id),
    messageIds: prefix.flatMap((message) =>
      message.placement === sourcePlacement ? [message.id] : []
    ),
  };
};
