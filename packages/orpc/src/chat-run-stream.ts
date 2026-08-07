import type { ChatRunStatus } from "@quieter/database/schema";

export const ACTIVE_CHAT_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_on_tool",
] as const satisfies ChatRunStatus[];

export const isActiveChatRunStatus = (
  status: ChatRunStatus,
): status is (typeof ACTIVE_CHAT_RUN_STATUSES)[number] =>
  ACTIVE_CHAT_RUN_STATUSES.includes(status as (typeof ACTIVE_CHAT_RUN_STATUSES)[number]);
