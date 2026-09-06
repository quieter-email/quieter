import { z } from "zod";

import type { ReleaseController } from "./controller.ts";

const writerSchema = z.object({
  head_branch: z.literal("main"),
  id: z.number().int().positive(),
  path: z.enum([
    ".github/workflows/release-runtime.yml",
    ".github/workflows/release-rollback.yml",
    ".github/workflows/release-proof.yml",
  ]),
  repository: z.object({ full_name: z.string() }),
  status: z.enum([
    "queued",
    "in_progress",
    "completed",
    "waiting",
    "pending",
    "requested",
  ]),
});

export const reconcileRelease = async (
  controller: Pick<ReleaseController, "journal" | "now" | "recover">,
  input: { eventRunId?: string; repository: string; token: string },
  request: typeof fetch = fetch
) => {
  const checkpoint = await controller.journal.read();
  const attempt = checkpoint?.state.attempt;
  if (!attempt || ["healthy", "rolled_back"].includes(attempt.status)) {
    return "settled";
  }
  if (
    input.eventRunId !== undefined &&
    input.eventRunId !== attempt.workflowRunId
  ) {
    return "stale_event";
  }
  if (!/^[\w.-]+\/[\w.-]+$/u.test(input.repository) || !input.token) {
    throw new Error(
      "Recovery requires the trusted repository and workflow-read credential."
    );
  }
  const response = await request(
    `https://api.github.com/repos/${input.repository}/actions/runs/${attempt.workflowRunId}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Cannot establish release writer status, HTTP ${response.status}.`
    );
  }
  const run = writerSchema.parse(await response.json());
  if (
    String(run.id) !== attempt.workflowRunId ||
    run.repository.full_name !== input.repository
  ) {
    throw new Error(
      "The workflow response does not identify the recorded release writer."
    );
  }
  if (run.status !== "completed") {
    if (controller.now().getTime() >= Date.parse(attempt.deadline)) {
      throw new Error(
        "Release deadline expired while its writer is still active. End the writer before recovery."
      );
    }
    return "writer_active";
  }
  await controller.recover(attempt.id, "writer_ended");
  return "recovered";
};
