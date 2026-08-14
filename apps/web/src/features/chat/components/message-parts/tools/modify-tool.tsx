"use client";

import type { ModifyMailToolResult } from "../../../types";
import { ToolStep } from "./tool-step";

const actionLabels: Record<ModifyMailToolResult["action"], string> = {
  archive: "Archived",
  mark_read: "Marked read",
  mark_unread: "Marked unread",
  star: "Starred",
  trash: "Moved to trash",
  unstar: "Unstarred",
  untrash: "Restored from trash",
};

const pendingActionLabels: Record<ModifyMailToolResult["action"], string> = {
  archive: "Archiving",
  mark_read: "Marking read",
  mark_unread: "Marking unread",
  star: "Starring",
  trash: "Moving to trash",
  unstar: "Unstarring",
  untrash: "Restoring",
};

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

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
  let label: string;
  if (resolvedAction === undefined) {
    label = pending ? "Updating mail" : "Updated mail";
  } else {
    label = pending
      ? pendingActionLabels[resolvedAction]
      : actionLabels[resolvedAction];
  }
  let meta: string | undefined;
  if (hasText(resolvedTarget) && (hasText(data?.id) || !pending)) {
    meta = resolvedTarget === "thread" ? "thread" : "message";
  }

  return (
    <ToolStep
      error={error}
      label={label}
      meta={meta}
      nested={nested}
      pending={pending}
    />
  );
};
