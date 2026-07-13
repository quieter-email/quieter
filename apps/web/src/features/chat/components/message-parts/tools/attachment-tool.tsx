"use client";

import { useState } from "react";
import type { GmailAttachmentToolResult } from "../../../types";
import { truncateToolDetail } from "../../../domain/tool-summaries";
import { ToolStep } from "./tool-step";

export const AttachmentTool = ({
  data,
  error,
  nested = false,
  pending,
}: {
  data?: GmailAttachmentToolResult;
  error?: string | null;
  nested?: boolean;
  pending: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const success = data?.status === "success" ? data : null;

  return (
    <ToolStep
      detail={success ? `“${truncateToolDetail(success.fileName)}”` : undefined}
      error={error}
      expandable={!!success}
      expanded={expanded}
      label={pending ? "Reading attachment" : "Read attachment"}
      meta={success ? `${Math.max(1, Math.round(success.size / 1_024))} KB` : undefined}
      nested={nested}
      onToggle={() => setExpanded((current) => !current)}
      pending={pending}
    >
      {success ? (
        <p className="text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
          {success.content || "(No text content)"}
          {success.contentTruncated ? "…" : ""}
        </p>
      ) : null}
    </ToolStep>
  );
};
