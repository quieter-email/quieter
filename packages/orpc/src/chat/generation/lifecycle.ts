import { serverEnv } from "@quieter/env/server";
import { getChatRunFailureMessage, terminalizeFailedChatRun } from "./failure";
import { runChatGeneration } from "./runner";
import { abortChatRun } from "./runtime";

const ENQUEUE_CHAT_RUN_TIMEOUT_MS = 10_000;
const inFlightGenerations = new Map<string, Promise<void>>();

export const ensureChatRunGeneration = (
  runId: string,
  options?: {
    force?: boolean;
  },
) => {
  const existing = inFlightGenerations.get(runId);
  if (existing) return existing;

  const generation = runChatGeneration(runId, options)
    .catch(async (error) => {
      console.error(`Chat generation ${runId} failed.`, error);
      await terminalizeFailedChatRun(runId, getChatRunFailureMessage(error)).catch(
        (updateError) => {
          console.error("Could not terminalize the failed chat generation.", updateError);
        },
      );
    })
    .finally(() => {
      inFlightGenerations.delete(runId);
    });

  inFlightGenerations.set(runId, generation);
  return generation;
};

const enqueueChatRun = async (runId: string) => {
  const startUrl = serverEnv.CHAT_GENERATION_START_URL;
  if (!startUrl) return;

  const token = serverEnv.CHAT_GENERATION_START_TOKEN;
  if (!token) {
    throw new Error(
      "CHAT_GENERATION_START_TOKEN is required when CHAT_GENERATION_START_URL is set.",
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENQUEUE_CHAT_RUN_TIMEOUT_MS);
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
      throw new Error(`Failed to enqueue chat generation (${response.status}): ${body}`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Timed out enqueueing chat generation after ${ENQUEUE_CHAT_RUN_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const startChatRun = async (runId: string) => {
  if (!serverEnv.CHAT_GENERATION_START_URL) {
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
  if (!startUrl || !token) {
    return;
  }

  const cancelUrl = new URL(`/runs/${encodeURIComponent(runId)}/cancel`, startUrl);
  try {
    await fetch(cancelUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.error(`Could not cancel remote chat generation ${runId}.`, error);
  }
};

export const cancelChatRun = (runId: string) => {
  abortChatRun(runId);
  void cancelChatRunRemote(runId);
};
