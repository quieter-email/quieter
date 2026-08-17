"use client";

import { truncateToolDetail } from "../../../domain/tool-summaries";
import type { GmailAttachmentToolResult } from "../../../types";
import { ToolStep } from "./tool-step";

export const AttachmentTool = ({
  active,
  data,
  error,
  nested = false,
  pending,
}: {
  active?: boolean;
  data?: GmailAttachmentToolResult;
  error?: string | null;
  nested?: boolean;
  pending: boolean;
}) => {
  const success = data?.status === "success" ? data : null;

  return (
    <ToolStep
      active={active}
      detail={success ? `“${truncateToolDetail(success.fileName)}”` : undefined}
      error={error}
      expandable={!!success}
      label={pending ? "Reading attachment" : "Read attachment"}
      meta={
        success
          ? `${Math.max(1, Math.round(success.size / 1024))} KB`
          : undefined
      }
      nested={nested}
      pending={pending}
    >
      {success ? (
        <p className="text-xs/relaxed whitespace-pre-wrap text-muted-fg">
          {success.content || "(No text content)"}
          {success.contentTruncated ? "…" : ""}
        </p>
      ) : null}
    </ToolStep>
  );
};
