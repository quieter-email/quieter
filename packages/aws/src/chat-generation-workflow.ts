import { runChatGeneration } from "@quieter/orpc/chat-generation";
import { workflow } from "sst/aws/workflow";

type ChatGenerationWorkflowEvent = {
  runId: string;
};

export const handler = workflow.handler<ChatGenerationWorkflowEvent>(async (event, ctx) => {
  await ctx.step("run-chat-generation", async () => {
    await runChatGeneration(event.runId);
  });
});
