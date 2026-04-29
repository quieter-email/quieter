import type { MessageListItem } from "~/lib/gmail/gmail";

export type MessageUnsubscribeTarget =
  | {
      kind: "mailto";
    }
  | {
      kind: "url";
      url: string;
    };

export const getMessageUnsubscribeTarget = (
  message: MessageListItem,
): MessageUnsubscribeTarget | null => {
  if (message.unsubscribeMailto) {
    return { kind: "mailto" };
  }

  if (message.unsubscribeUrl) {
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
