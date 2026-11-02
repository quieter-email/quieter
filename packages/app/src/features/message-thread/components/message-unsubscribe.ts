import type { MessageListItem } from "@quieter/app/lib/mail";

export type MessageUnsubscribeTarget =
  | {
      kind: "mailto";
    }
  | { kind: "confirming" }
  | {
      kind: "url";
      url: string;
    };

export const messageUnsubscribeLabels = {
  confirming: "Check unsubscribe request",
  mailto: "Unsubscribe",
  url: "Open unsubscribe page",
} as const;

export const getMessageUnsubscribeTarget = (
  message: MessageListItem
): MessageUnsubscribeTarget | null => {
  if (message.unsubscribeStatus === "requested") {
    return null;
  }
  if (message.unsubscribeStatus === "confirming") {
    return { kind: "confirming" };
  }
  if (
    message.unsubscribeMailto !== null &&
    message.unsubscribeMailto !== undefined &&
    message.unsubscribeMailto !== ""
  ) {
    return { kind: "mailto" };
  }

  if (
    message.unsubscribeUrl !== null &&
    message.unsubscribeUrl !== undefined &&
    message.unsubscribeUrl !== ""
  ) {
    return {
      kind: "url",
      url: message.unsubscribeUrl,
    };
  }

  return null;
};

export const openUnsubscribeUrl = (url: string) => {
  const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (openedWindow) {
    openedWindow.opener = null;
  }
};
