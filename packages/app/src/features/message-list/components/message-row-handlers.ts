import { toastError } from "@quieter/app/lib/error-toast";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import type { FocusEvent, KeyboardEvent, MouseEvent } from "react";

import type { MessageListProps } from "./message-list-types";
import type { useMessageListSelection } from "./use-message-list-selection";

export const createMessageRowHandlers = ({
  isActionPending,
  isActive,
  mailboxActions,
  onKeyboardOpen,
  onThreadFocus,
  onThreadIntent,
  onThreadPress,
  onThreadSelectionPress,
  showSelectionControl,
  thread,
  unread,
}: {
  isActionPending: boolean;
  isActive: boolean;
  mailboxActions: MessageListProps["mailboxActions"];
  onKeyboardOpen?: () => void;
  onThreadFocus: (threadId: string | null) => void;
  onThreadIntent: (threadId: string | null) => void;
  onThreadPress: ReturnType<
    typeof useMessageListSelection
  >["handleThreadPress"];
  onThreadSelectionPress: ReturnType<
    typeof useMessageListSelection
  >["handleThreadSelectionPress"];
  showSelectionControl: boolean;
  thread: ThreadListEntry;
  unread: boolean;
}) => {
  const handleRowMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const gesture = {
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    };

    if (gesture.additive || gesture.range) {
      onThreadPress(thread, gesture);
    }
  };
  const handleRowClick = (
    event: Pick<
      MouseEvent<HTMLButtonElement>,
      "ctrlKey" | "metaKey" | "shiftKey" | "detail"
    >
  ) => {
    const gesture = {
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    };

    if (gesture.additive || gesture.range) {
      return;
    }

    if (!isActive && event.detail === 0) {
      onKeyboardOpen?.();
    }

    if (
      !isActive &&
      !showSelectionControl &&
      unread &&
      mailboxActions.canMarkRead &&
      !isActionPending
    ) {
      void (async () => {
        try {
          await mailboxActions.markThreadAsRead(thread.threadId);
        } catch (error) {
          toastError(error, { boundary: "message-read-state" });
        }
      })();
    }

    onThreadPress(thread, gesture);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      event.key !== " " ||
      (!event.metaKey && !event.ctrlKey && !event.shiftKey)
    ) {
      return;
    }

    event.preventDefault();
    onThreadSelectionPress(thread, {
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    });
  };
  const handleRowFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement)) {
      return;
    }
    if (!Object.hasOwn(event.target.dataset, "messageRowTrigger")) {
      return;
    }

    onThreadFocus(thread.threadId);
    onThreadIntent(thread.threadId);
  };
  const handleRowBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }

    onThreadFocus(null);
    onThreadIntent(null);
  };

  return {
    handleRowBlurCapture,
    handleRowClick,
    handleRowFocusCapture,
    handleRowKeyDown,
    handleRowMouseDown,
  };
};
