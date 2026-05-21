import { m } from "motion/react";
import type { ChatTurn } from "../types";
import { AssistantParts, UserParts } from "./message-parts";

export const ConversationTurn = ({ turn }: { turn: ChatTurn }) => {
  const hasUserContent = Boolean(turn.user?.parts.length);

  return (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {turn.user && hasUserContent && (
        <div className="flex justify-end">
          <p className="max-w-[80%] text-sm leading-relaxed text-foreground sm:max-w-[70%]">
            <UserParts parts={turn.user.parts} />
          </p>
        </div>
      )}

      {turn.assistant && (
        <div className="flex flex-col gap-2">
          <AssistantParts parts={turn.assistant.parts} />
        </div>
      )}
    </m.div>
  );
};
