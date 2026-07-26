import { runChatGeneration } from "@quieter/orpc/chat-generation";
import { workflow } from "sst/aws/workflow";
import { withSentry } from "./sentry";

type ChatGenerationWorkflowEvent = {
  runId: string;
};

export const handler = workflow.handler<ChatGenerationWorkflowEvent>((event, ctx) =>
  withSentry("ChatGenerationWorkflow", async () => {
    await ctx.step("run-chat-generation", async () => {
      await runChatGeneration(event.runId);
    });
  })(),
);
