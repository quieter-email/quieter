"use client";

import { useState } from "react";
import type { MailboxOverviewToolResult } from "../../../types";
import { ToolStep } from "./tool-step";

type OverviewToolProps = {
  nested?: boolean;
  data?: MailboxOverviewToolResult;
  error?: string | null;
  pending: boolean;
};

const formatCount = (value: number | undefined) =>
  typeof value === "number" ? value.toLocaleString() : "—";

export const OverviewTool = ({ nested = false, data, error, pending }: OverviewToolProps) => {
  const [expanded, setExpanded] = useState(false);
  const success = data?.status === "success" ? data : null;
  const meta = pending
    ? undefined
    : error
      ? undefined
      : success
        ? `${formatCount(success.unreadMessages)} unread`
        : undefined;

  return (
    <ToolStep
      nested={nested}
      detail={success?.emailAddress}
      error={error}
      expandable={!!success}
      expanded={expanded}
      label={pending ? "Checking mailbox" : "Checked mailbox"}
      meta={meta}
      onToggle={() => setExpanded((current) => !current)}
      pending={pending}
    >
      {success ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-3">
            <dt>Messages</dt>
            <dd className="text-foreground/80 tabular-nums">
              {formatCount(success.totalMessages)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Threads</dt>
            <dd className="text-foreground/80 tabular-nums">{formatCount(success.totalThreads)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Unread</dt>
            <dd className="text-foreground/80 tabular-nums">
              {formatCount(success.unreadMessages)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Starred</dt>
            <dd className="text-foreground/80 tabular-nums">
              {formatCount(success.starredMessages)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Attachments</dt>
            <dd className="text-foreground/80 tabular-nums">
              {formatCount(success.attachmentMessages)}
            </dd>
          </div>
        </dl>
      ) : null}
    </ToolStep>
  );
};
