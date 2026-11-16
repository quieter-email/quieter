export type PlacementMessage = {
  id: string;
  threadId: string;
  receivedAt: number;
  placement: "inbox" | "done" | "protected";
};

export const resolvePlacementMessageIds = (input: {
  messages: PlacementMessage[];
  placement: "done" | "inbox";
  threadId: string;
  requestedMessageIds: string[];
}): string[] | null => {
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
  return messages
    .slice(0, lastAnchorIndex + 1)
    .flatMap((message) =>
      message.threadId === input.threadId &&
      message.placement === sourcePlacement
        ? [message.id]
        : []
    );
};
