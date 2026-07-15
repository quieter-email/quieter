import type { ChatMessagePart } from "@quieter/database/schema";
import { terminalizeChatRun } from "../../chat-run-store";
import { publishChatRunEvent } from "../../chat-run-stream";

export const getChatRunFailureMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";

  if (/mail lookup/i.test(message)) {
    return "The mail lookup stopped responding. Retry with a narrower request.";
  }

  if (/\b(?:401|403)\b|invalid[_\s-]?token|unauthori[sz]ed|forbidden/i.test(message)) {
    return "Quieter could not authenticate with a required service. Please contact support.";
  }

  if (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    /timed?\s*out|timeout/i.test(message)
  ) {
    return "The response took too long and was stopped. Retry it to continue.";
  }

  if (error instanceof TypeError || /connection|fetch|network|stream/i.test(message)) {
    return "The response connection was interrupted. Retry it to continue.";
  }

  return "The response could not finish. Retry it to continue.";
};

export const terminalizeFailedChatRun = async (
  runId: string,
  error: string,
  assistant?: { id: string; parts: ChatMessagePart[] },
) => {
  const terminal = await terminalizeChatRun({
    error,
    parts: assistant?.parts,
    runId,
    status: "failed",
  });

  if (!terminal) {
    return;
  }

  publishChatRunEvent(runId, {
    ...terminal,
    type: "done",
  });
};
