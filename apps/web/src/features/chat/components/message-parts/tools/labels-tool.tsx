"use client";

import { useState } from "react";
import type { GmailLabelListToolResult } from "../../../types";
import { ToolStep } from "./tool-step";

type LabelsToolProps = {
  nested?: boolean;
  data?: GmailLabelListToolResult;
  error?: string | null;
  pending: boolean;
};

export const LabelsTool = ({ nested = false, data, error, pending }: LabelsToolProps) => {
  const [expanded, setExpanded] = useState(false);
  const success = data?.status === "success" ? data : null;
  const userLabels = success?.labels.filter((label) => label.type === "user") ?? [];
  const meta = pending
    ? undefined
    : error
      ? undefined
      : success
        ? `${success.labels.length} label${success.labels.length === 1 ? "" : "s"}`
        : undefined;

  return (
    <ToolStep
      nested={nested}
      error={error}
      expandable={!!success && success.labels.length > 0}
      expanded={expanded}
      label={pending ? "Listing labels" : "Listed labels"}
      meta={meta}
      onToggle={() => setExpanded((current) => !current)}
      pending={pending}
    >
      {success ? (
        <div className="space-y-2">
          {userLabels.length > 0 ? (
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground/75">Custom</p>
              <div className="flex flex-wrap gap-1.5">
                {userLabels.map((label) => (
                  <span
                    className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-foreground/80"
                    key={label.id}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground/75">
            {success.labels.length - userLabels.length} system label
            {success.labels.length - userLabels.length === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}
    </ToolStep>
  );
};
