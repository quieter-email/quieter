import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";

import { hasText } from "../../text";
import { getChatRunFailureMessage, terminalizeFailedChatRun } from "./failure";
import { runChatGeneration } from "./runner";
import { abortChatRun } from "./runtime";

const ENQUEUE_CHAT_RUN_TIMEOUT_MS = 10_000;
const inFlightGenerations = new Map<string, Promise<void>>();

export const ensureChatRunGeneration = async (
  runId: string,
  options?: {
    force?: boolean;
  }
) => {
  const existing = inFlightGenerations.get(runId);
  if (existing) {
    await existing;
    return;
  }

  const generation = (async () => {
    try {
      await runChatGeneration(runId, options);
    } catch (error: unknown) {
      reportError(error, { operation: "chat-generation:lifecycle" });
      try {
        await terminalizeFailedChatRun(runId, getChatRunFailureMessage(error));
      } catch (updateError: unknown) {
        reportError(updateError, {
          operation: "chat-generation:terminalize-failure",
        });
      }
    } finally {
      inFlightGenerations.delete(runId);
    }
  })();

  inFlightGenerations.set(runId, generation);
  await generation;
};

const enqueueChatRun = async (runId: string) => {
  const startUrl = serverEnv.CHAT_GENERATION_START_URL;
  if (!hasText(startUrl)) {
    return;
  }

  const token = serverEnv.CHAT_GENERATION_START_TOKEN;
  if (!hasText(token)) {
    throw new Error(
      "CHAT_GENERATION_START_TOKEN is required when CHAT_GENERATION_START_URL is set."
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, ENQUEUE_CHAT_RUN_TIMEOUT_MS);
  try {
    const response = await fetch(startUrl, {
      body: JSON.stringify({ runId }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to enqueue chat generation (${response.status}): ${body}`
      );
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Timed out enqueueing chat generation after ${ENQUEUE_CHAT_RUN_TIMEOUT_MS}ms.`,
        { cause: error }
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const startChatRun = async (runId: string) => {
  if (!hasText(serverEnv.CHAT_GENERATION_START_URL)) {
    const generation = ensureChatRunGeneration(runId);
    if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local") {
      await generation;
    }
    return;
  }

  await enqueueChatRun(runId);
};

/** Best-effort remote abort when generation runs outside this isolate. */
export const cancelChatRunRemote = async (runId: string) => {
  const startUrl = serverEnv.CHAT_GENERATION_START_URL;
  const token = serverEnv.CHAT_GENERATION_START_TOKEN;
  if (!hasText(startUrl) || !hasText(token)) {
    return;
  }

  const cancelUrl = new URL(
    `/runs/${encodeURIComponent(runId)}/cancel`,
    startUrl
  );
  try {
    await fetch(cancelUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    reportError(error, { operation: "chat-generation:cancel-remote" });
  }
};

export const cancelChatRun = (runId: string) => {
  abortChatRun(runId);
  void cancelChatRunRemote(runId);
};
