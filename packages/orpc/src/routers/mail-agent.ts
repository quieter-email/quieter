import { mailAgentInputs } from "../mail-agent/contracts";
import {
  activateMailAgent,
  enqueueManualMailAgentRun,
  getMailAgentSettings,
  getMailAgentThreadResults,
  pauseMailAgent,
  reviewMailAgent,
} from "../mail-agent/service";
import { protectedProcedure } from "./base";

export const mailAgentRouter = {
  activate: protectedProcedure
    .input(mailAgentInputs.activate)
    .handler(
      async ({ context, input }) =>
        await activateMailAgent({ ...input, userId: context.userId })
    ),
  get: protectedProcedure
    .route({ method: "GET" })
    .input(mailAgentInputs.get)
    .handler(
      async ({ context, input }) =>
        await getMailAgentSettings({ ...input, userId: context.userId })
    ),
  pause: protectedProcedure
    .input(mailAgentInputs.pause)
    .handler(
      async ({ context, input }) =>
        await pauseMailAgent({ ...input, userId: context.userId })
    ),
  review: protectedProcedure.input(mailAgentInputs.review).handler(
    async ({ context, input }) =>
      await reviewMailAgent({
        ...input,
        signal: context.signal,
        userId: context.userId,
      })
  ),
  run: protectedProcedure
    .input(mailAgentInputs.run)
    .handler(
      async ({ context, input }) =>
        await enqueueManualMailAgentRun({ ...input, userId: context.userId })
    ),
  threadResults: protectedProcedure
    .route({ method: "GET" })
    .input(mailAgentInputs.threadResults)
    .handler(
      async ({ context, input }) =>
        await getMailAgentThreadResults({ ...input, userId: context.userId })
    ),
};
