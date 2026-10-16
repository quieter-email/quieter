import {
  configureDailyBrief,
  dailyBriefInputs,
  getDailyBrief,
  giveDailyBriefFeedback,
  prepareDailyBrief,
  recordDailyBriefActivity,
  refreshDailyBrief,
} from "../daily-brief";
import { protectedProcedure } from "./base";

export const dailyBriefRouter = {
  activity: protectedProcedure
    .input(dailyBriefInputs.activity)
    .handler(recordDailyBriefActivity),
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
  prepare: protectedProcedure
    .input(dailyBriefInputs.prepare)
    .handler(prepareDailyBrief),
  refresh: protectedProcedure
    .input(dailyBriefInputs.refresh)
    .handler(refreshDailyBrief),
};
