"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { useState } from "react";

import { cn } from "../../lib/cn";
import { useColorMode } from "./color-mode";

const senderAvatarVariants = cva(
  "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg font-medium text-muted-fg",
  {
    defaultVariants: { size: "default" },
    variants: {
      size: {
        default: "size-9 text-body",
        sm: "size-8 text-body-sm",
        xs: "size-7 text-caption",
      },
    },
  }
);

type SenderAvatarProps = VariantProps<typeof senderAvatarVariants> & {
  avatarUrlLight?: string;
  avatarUrlDark?: string;
  fallbackLabel: string;
  className?: string;
};

type AvatarStatus = "error" | "loaded";

export const SenderAvatar = ({
  avatarUrlDark,
  avatarUrlLight,
  className,
  fallbackLabel,
  size = "default",
}: SenderAvatarProps) => {
  const { colorMode } = useColorMode();
  const [avatarStatusByUrl, setAvatarStatusByUrl] = useState<
    Record<string, AvatarStatus>
  >({});
  const activeAvatarUrl =
    colorMode === "dark"
      ? (avatarUrlDark ?? avatarUrlLight)
      : (avatarUrlLight ?? avatarUrlDark);
  const activeAvatarStatus = activeAvatarUrl
    ? avatarStatusByUrl[activeAvatarUrl]
    : undefined;
  const canRenderAvatar = !!activeAvatarUrl && activeAvatarStatus !== "error";
  const showFallback = !activeAvatarUrl || activeAvatarStatus !== "loaded";

  const updateAvatarStatus = (url: string, status: AvatarStatus) => {
    setAvatarStatusByUrl((current) =>
      current[url] === status ? current : { ...current, [url]: status }
    );
  };

  return (
    <div
      className={cn(
        senderAvatarVariants({ size }),
        { "bg-muted/80": showFallback },
        className
      )}
    >
      {showFallback && <span>{fallbackLabel}</span>}

      {canRenderAvatar && activeAvatarUrl ? (
        <img
          alt=""
          aria-hidden="true"
          className={cn("absolute inset-0 size-full object-cover", {
            "opacity-0": showFallback,
          })}
          key={activeAvatarUrl}
          onError={() => {
            updateAvatarStatus(activeAvatarUrl, "error");
          }}
          onLoad={() => {
            updateAvatarStatus(activeAvatarUrl, "loaded");
          }}
          src={activeAvatarUrl}
        />
      ) : null}
    </div>
  );
};
