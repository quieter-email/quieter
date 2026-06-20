import { serverEnv } from "@quieter/env/server";
import { terminalizeFailedChatRun } from "./failure";
import { runChatGeneration } from "./runner";

const ENQUEUE_CHAT_RUN_TIMEOUT_MS = 10_000;
const inFlightGenerations = new Map<string, Promise<void>>();

export const ensureChatRunGeneration = (runId: string) => {
  const existing = inFlightGenerations.get(runId);
  if (existing) return existing;

  const generation = runChatGeneration(runId)
    .catch(async (error) => {
      console.error("Chat generation failed.", error);
      await terminalizeFailedChatRun(
        runId,
        error instanceof Error ? error.message : "Chat generation failed.",
      ).catch((updateError) => {
        console.error("Could not terminalize the failed chat generation.", updateError);
      });
    })
    .finally(() => {
      inFlightGenerations.delete(runId);
    });

  inFlightGenerations.set(runId, generation);
  return generation;
};

export const handoffChatRunToBackground = (runId: string) => {
  void enqueueChatRun(runId).catch((error) => {
    console.error("Could not hand off chat generation to the background worker.", error);
    return ensureChatRunGeneration(runId);
  });
};

export const enqueueChatRun = async (runId: string) => {
  const startUrl = serverEnv.CHAT_GENERATION_START_URL;
  if (!startUrl) {
    await ensureChatRunGeneration(runId);
    return;
  }

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
