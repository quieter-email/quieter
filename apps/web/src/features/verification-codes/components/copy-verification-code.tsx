"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
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
    <Button
      aria-label={`Copy verification code ${code}`}
      className={cn(
        "pointer-events-auto relative z-20 cursor-pointer",
        className
      )}
      data-verification-code-copy
      onClick={(event) => {
        event.stopPropagation();
        void copyCode();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      size="compact"
      type="button"
      variant="outline"
    >
      {code}
      <HugeiconsIcon aria-hidden className="size-3" icon={Copy01Icon} />
    </Button>
  );
};
