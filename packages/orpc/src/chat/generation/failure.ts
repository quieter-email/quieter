import { chatMessage, chatRun, db, type ChatMessagePart } from "@quieter/database";
import { eq } from "drizzle-orm";
import { updateAssistantMessage, updateRunStatus } from "../../chat-run-store";
import { publishChatRunEvent } from "../../chat-run-stream";

export const terminalizeFailedChatRun = async (
  runId: string,
  error: string,
  assistant?: { id: string; parts: ChatMessagePart[] },
) => {
  let terminalAssistant = assistant;
  if (!terminalAssistant) {
    const [run] = await db
      .select({ assistantMessageId: chatRun.assistantMessageId })
      .from(chatRun)
      .where(eq(chatRun.id, runId))
      .limit(1);
    if (!run) return;

    const [message] = await db
      .select({ parts: chatMessage.parts })
      .from(chatMessage)
      .where(eq(chatMessage.id, run.assistantMessageId))
      .limit(1);
    terminalAssistant = {
      id: run.assistantMessageId,
      parts: message?.parts ?? [{ content: "", type: "text" }],
    };
  }

  await Promise.all([
    updateAssistantMessage({
      assistantMessageId: terminalAssistant.id,
      error,
      parts: terminalAssistant.parts,
      status: "failed",
    }),
    updateRunStatus(runId, "failed", { error }),
  ]);
  publishChatRunEvent(runId, {
    assistantMessageId: terminalAssistant.id,
    error,
    parts: terminalAssistant.parts,
    status: "failed",
    type: "done",
  });
};
