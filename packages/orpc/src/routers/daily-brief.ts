import {
  configureDailyBrief,
  dailyBriefInputs,
  getDailyBrief,
  giveDailyBriefFeedback,
  refreshDailyBrief,
} from "../daily-brief";
import { protectedProcedure } from "./base";

export const dailyBriefRouter = {
  configure: protectedProcedure
    .input(dailyBriefInputs.configure)
    .handler(configureDailyBrief),
  feedback: protectedProcedure
    .input(dailyBriefInputs.feedback)
    .handler(giveDailyBriefFeedback),
  get: protectedProcedure
    .route({ method: "GET" })
    .input(dailyBriefInputs.get)
    .handler(getDailyBrief),
  refresh: protectedProcedure
    .input(dailyBriefInputs.refresh)
    .handler(refreshDailyBrief),
};
