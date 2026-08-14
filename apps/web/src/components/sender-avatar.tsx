"use client";

import { cn } from "@quieter/ui/cn";
import { useColorMode } from "@quieter/ui/color-mode";
import { useState } from "react";

type SenderAvatarProps = {
  avatarUrlLight?: string;
  avatarUrlDark?: string;
  fallbackLabel: string;
  className?: string;
  labelClassName?: string;
};

type AvatarStatus = "error" | "loaded";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

export const SenderAvatar = ({
  avatarUrlDark,
  avatarUrlLight,
  className,
  fallbackLabel,
  labelClassName,
}: SenderAvatarProps) => {
  const { colorMode } = useColorMode();
  const [avatarStatusByUrl, setAvatarStatusByUrl] = useState<
    Record<string, AvatarStatus>
  >({});
  const activeAvatarUrl =
    colorMode === "dark"
      ? (avatarUrlDark ?? avatarUrlLight)
      : (avatarUrlLight ?? avatarUrlDark);
  const activeAvatarStatus = hasText(activeAvatarUrl)
    ? avatarStatusByUrl[activeAvatarUrl]
    : undefined;
  const canRenderAvatar =
    hasText(activeAvatarUrl) && activeAvatarStatus !== "error";
  const showFallback =
    !hasText(activeAvatarUrl) || activeAvatarStatus !== "loaded";

  const updateAvatarStatus = (url: string, status: AvatarStatus) => {
    setAvatarStatusByUrl((current) =>
      current[url] === status ? current : { ...current, [url]: status }
    );
  };

  return (
    <div
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-medium text-muted-fg",
        { "bg-muted/80": showFallback },
        className
      )}
    >
      {showFallback && <span className={labelClassName}>{fallbackLabel}</span>}

      {canRenderAvatar && hasText(activeAvatarUrl) ? (
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
