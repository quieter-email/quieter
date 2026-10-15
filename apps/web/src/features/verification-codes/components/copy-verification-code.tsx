"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { toast } from "@quieter/ui/toast";

import { toastError } from "#/lib/error-toast";

export const CopyVerificationCode = ({
  className,
  code,
}: {
  className?: string;
  code: string;
}) => {
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Code copied.");
    } catch (error) {
      toastError(error, {
        boundary: "verification-code-copy",
        fallback: "Could not copy code.",
      });
    }
  };

  return (
    <button
      aria-label={`Copy verification code ${code}`}
      className={cn(
        "pointer-events-auto relative z-20 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 font-mono text-caption font-semibold text-fg tabular-nums hover:bg-control-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className
      )}
      onClick={(event) => {
        event.stopPropagation();
        void copyCode();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      type="button"
    >
      {code}
      <HugeiconsIcon aria-hidden className="size-3" icon={Copy01Icon} />
    </button>
  );
};
