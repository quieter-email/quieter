"use client";

import type { GmailLabelListToolResult } from "../../../types";
import type { ToolIcon } from "./tool-icons";
import { ToolStep } from "./tool-step";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

type LabelsToolProps = {
  active?: boolean;
  icon?: ToolIcon;
  nested?: boolean;
  data?: GmailLabelListToolResult;
  error?: string | null;
  pending: boolean;
};

export const LabelsTool = ({
  active,
  icon,
  nested = false,
  data,
  error,
  pending,
}: LabelsToolProps) => {
  const success = data?.status === "success" ? data : null;
  const userLabels =
    success?.labels.filter((label) => label.type === "user") ?? [];
  let meta: string | undefined;
  if (pending || hasText(error)) {
    meta = undefined;
  } else if (success !== null) {
    meta = `${success.labels.length} label${success.labels.length === 1 ? "" : "s"}`;
  }

  return (
    <ToolStep
      active={active}
      icon={icon}
      nested={nested}
      error={error}
      expandable={!!success && success.labels.length > 0}
      label={pending ? "Listing labels" : "Listed labels"}
      meta={meta}
      pending={pending}
    >
      {success ? (
        <div className="space-y-2">
          {userLabels.length > 0 ? (
            <div>
              <p className="mb-1 text-micro text-muted-fg/75">Custom</p>
              <div className="flex flex-wrap gap-1.5">
                {userLabels.map((label) => (
                  <span
                    className="rounded-full border border-border px-2 py-0.5 text-micro text-fg/80"
                    key={label.id}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-micro text-muted-fg/75">
            {success.labels.length - userLabels.length} system label
            {success.labels.length - userLabels.length === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}
    </ToolStep>
  );
};
