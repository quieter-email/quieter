import { m } from "motion/react";
import type { ChatTurn } from "../types";
import { AssistantParts, UserParts } from "./message-parts";

export const ConversationTurn = ({
  isStreaming = false,
  turn,
}: {
  isStreaming?: boolean;
  turn: ChatTurn;
}) => {
  const hasUserContent = Boolean(turn.user?.parts.length);

  return (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2.5"
      initial={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {turn.user && hasUserContent && (
        <div className="flex flex-col items-end gap-1">
          <p className="squircle max-w-[80%] rounded-lg bg-background/85 px-4 py-2.5 text-sm leading-relaxed text-foreground sm:max-w-[70%]">
            <UserParts parts={turn.user.parts} />
          </p>
        </div>
      )}

      {turn.assistant && (
        <div className="flex flex-col gap-1.5">
          <AssistantParts isStreaming={isStreaming} parts={turn.assistant.parts} />
        </div>
      )}
    </m.div>
  );
};
