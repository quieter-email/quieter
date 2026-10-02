"use client";

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
        "pointer-events-auto relative z-20 shrink-0 rounded-sm font-mono text-caption font-semibold text-fg tabular-nums hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
    </button>
  );
};
