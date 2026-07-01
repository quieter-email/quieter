"use client";

import { Copy01Icon, Edit01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { type KeyboardEvent, useState } from "react";
import type { ChatTurn, ResolveComposeTool } from "../types";
import { getCopyableMessageText } from "../domain/copy-message-text";
import { MessageActions } from "./message-actions";
import { AssistantParts } from "./message-parts/assistant-parts";
import { UserParts } from "./message-parts/user-parts";

type ConversationTurnProps = {
  actionsDisabled?: boolean;
  isLastTurn: boolean;
  isStreaming?: boolean;
  onCopy: (text: string) => void;
  onEditSubmit: (userMessageId: string, message: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  onResolveCompose: ResolveComposeTool;
  turn: ChatTurn;
};

export const ConversationTurn = ({
  actionsDisabled = false,
  isLastTurn,
  isStreaming = false,
  onCopy,
  onEditSubmit,
  onRegenerate,
  onResolveCompose,
  turn,
}: ConversationTurnProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const hasUserContent = Boolean(turn.user?.parts.length);
  const showActions = !actionsDisabled && (!isLastTurn || !isStreaming);
  const userCopyText = turn.user ? getCopyableMessageText(turn.user.parts) : "";
  const assistantCopyText = turn.assistant ? getCopyableMessageText(turn.assistant.parts) : "";
  const assistantMessageId = turn.assistant?.id;
  const startEditing = () => {
    if (!turn.user) {
      return;
    }

    setEditDraft(getCopyableMessageText(turn.user.parts));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditDraft("");
  };

  const submitEdit = () => {
    const message = editDraft.trim();
    if (!turn.user || !message) {
      return;
    }

    onEditSubmit(turn.user.id, message);
    setIsEditing(false);
    setEditDraft("");
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitEdit();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {turn.user && hasUserContent ? (
        <div className="group/message flex flex-col items-end gap-1">
          {isEditing ? (
            <div className="flex w-full max-w-[85%] flex-col gap-2 sm:max-w-[75%]">
              <textarea
                aria-label="Edit message"
                className="keyboard-focus-ring min-h-20 w-full resize-none rounded-lg border border-border bg-muted px-3.5 py-2 text-sm/relaxed text-foreground focus:outline-none"
                onChange={(event) => setEditDraft(event.target.value)}
                onKeyDown={handleEditKeyDown}
                value={editDraft}
              />
              <div className="flex justify-end gap-2">
                <Button onClick={cancelEditing} size="sm" type="button" variant="ghost">
                  Cancel
                </Button>
                <Button disabled={!editDraft.trim()} onClick={submitEdit} size="sm" type="button">
                  Save & submit
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="max-w-[85%] rounded-lg bg-muted px-3.5 py-2 text-sm/relaxed text-foreground sm:max-w-[75%]">
                <UserParts parts={turn.user.parts} />
              </div>
              {showActions ? (
                <MessageActions align="end">
                  {userCopyText ? (
                    <IconButtonTooltip label="Copy">
                      <Button
                        aria-label="Copy"
                        onClick={() => onCopy(userCopyText)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <HugeiconsIcon icon={Copy01Icon} />
                      </Button>
                    </IconButtonTooltip>
                  ) : null}
                  <IconButtonTooltip label="Edit">
                    <Button
                      aria-label="Edit"
                      onClick={startEditing}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <HugeiconsIcon icon={Edit01Icon} />
                    </Button>
                  </IconButtonTooltip>
                </MessageActions>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {turn.assistant ? (
        <div className="group/message flex flex-col gap-1">
          <AssistantParts
            actionsDisabled={actionsDisabled}
            assistantMessageId={turn.assistant.id}
            isStreaming={isStreaming}
            onResolveCompose={onResolveCompose}
            parts={turn.assistant.parts}
          />
          {showActions ? (
            <MessageActions align="start">
              {assistantCopyText ? (
                <IconButtonTooltip label="Copy">
                  <Button
                    aria-label="Copy"
                    onClick={() => onCopy(assistantCopyText)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon icon={Copy01Icon} />
                  </Button>
                </IconButtonTooltip>
              ) : null}
              <IconButtonTooltip label="Regenerate">
                <Button
                  aria-label="Regenerate"
                  onClick={() => {
                    if (assistantMessageId) {
                      onRegenerate(assistantMessageId);
                    }
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={Refresh01Icon} />
                </Button>
              </IconButtonTooltip>
            </MessageActions>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
