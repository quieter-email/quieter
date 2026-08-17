"use client";

import type { MailboxOverviewToolResult } from "../../../types";
import { ToolStep } from "./tool-step";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

type OverviewToolProps = {
  active?: boolean;
  nested?: boolean;
  data?: MailboxOverviewToolResult;
  error?: string | null;
  pending: boolean;
};

const formatCount = (value: number | undefined) =>
  typeof value === "number" ? value.toLocaleString() : "—";

export const OverviewTool = ({
  active,
  nested = false,
  data,
  error,
  pending,
}: OverviewToolProps) => {
  const success = data?.status === "success" ? data : null;
  let meta: string | undefined;
  if (pending || hasText(error)) {
    meta = undefined;
  } else if (success !== null) {
    meta = `${formatCount(success.unreadMessages)} unread`;
  }

  return (
    <ToolStep
      active={active}
      nested={nested}
      detail={success?.emailAddress}
      error={error}
      expandable={!!success}
      label={pending ? "Checking mailbox" : "Checked mailbox"}
      meta={meta}
      pending={pending}
    >
      {success ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-fg">
          <div className="flex justify-between gap-3">
            <dt>Messages</dt>
            <dd className="text-fg/80 tabular-nums">
              {formatCount(success.totalMessages)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Threads</dt>
            <dd className="text-fg/80 tabular-nums">
              {formatCount(success.totalThreads)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Unread</dt>
            <dd className="text-fg/80 tabular-nums">
              {formatCount(success.unreadMessages)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Starred</dt>
            <dd className="text-fg/80 tabular-nums">
              {formatCount(success.starredMessages)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Attachments</dt>
            <dd className="text-fg/80 tabular-nums">
              {formatCount(success.attachmentMessages)}
            </dd>
          </div>
        </dl>
      ) : null}
    </ToolStep>
  );
};
