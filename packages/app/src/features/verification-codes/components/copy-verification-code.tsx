"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toastError } from "@quieter/app/lib/error-toast";
import { Button } from "@quieter/ui/button";
import type { ButtonProps } from "@quieter/ui/button";
import { toast } from "@quieter/ui/toast";

export const CopyVerificationCode = ({
  code,
  size = "compact",
}: {
  code: string;
  size?: ButtonProps["size"];
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
      className="pointer-events-auto relative z-20"
      data-verification-code-copy
      onClick={(event) => {
        event.stopPropagation();
        void copyCode();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      size={size}
      type="button"
      variant="outline"
    >
      {code}
      <HugeiconsIcon aria-hidden className="size-3" icon={Copy01Icon} />
    </Button>
  );
};
