"use client";

import type { ModifyMailToolResult } from "../../../types";
import { ToolStep } from "./tool-step";

const actionLabels: Record<ModifyMailToolResult["action"], string> = {
  archive: "Archived",
  mark_read: "Marked read",
  mark_unread: "Marked unread",
  star: "Starred",
  trash: "Moved to trash",
  untrash: "Restored from trash",
  unstar: "Unstarred",
};

const pendingActionLabels: Record<ModifyMailToolResult["action"], string> = {
  archive: "Archiving",
  mark_read: "Marking read",
  mark_unread: "Marking unread",
  star: "Starring",
  trash: "Moving to trash",
  untrash: "Restoring",
  unstar: "Unstarring",
};

type ModifyToolProps = {
  action?: ModifyMailToolResult["action"];
  nested?: boolean;
  data?: ModifyMailToolResult;
  error?: string | null;
  pending: boolean;
  target?: ModifyMailToolResult["target"];
};

export const ModifyTool = ({
  action,
  nested = false,
  data,
  error,
  pending,
  target,
}: ModifyToolProps) => {
  const resolvedAction = data?.action ?? action;
  const resolvedTarget = data?.target ?? target;
  const label = resolvedAction
    ? pending
      ? pendingActionLabels[resolvedAction]
      : actionLabels[resolvedAction]
    : pending
      ? "Updating mail"
      : "Updated mail";
  const meta =
    resolvedTarget && (data?.id || !pending)
      ? resolvedTarget === "thread"
        ? "thread"
        : "message"
      : undefined;

  return <ToolStep error={error} label={label} meta={meta} nested={nested} pending={pending} />;
};
