"use client";

import { cn, useColorMode } from "@quietr/ui";
import Image from "next/image";
import { useState } from "react";

type SenderAvatarProps = {
  avatarUrlLight?: string;
  avatarUrlDark?: string;
  fallbackLabel: string;
  className?: string;
  labelClassName?: string;
};

type AvatarStatus = "error" | "loaded";

export const SenderAvatar = ({
  avatarUrlDark,
  avatarUrlLight,
  className,
  fallbackLabel,
  labelClassName,
}: SenderAvatarProps) => {
  const { colorMode } = useColorMode();
  const hasAvatar = Boolean(avatarUrlLight || avatarUrlDark);
  const [avatarStatusByUrl, setAvatarStatusByUrl] = useState<Record<string, AvatarStatus>>({});
  const isSameUrl = Boolean(avatarUrlLight && avatarUrlDark && avatarUrlLight === avatarUrlDark);
  const activeAvatarUrl = isSameUrl
    ? avatarUrlLight
    : colorMode === "dark"
      ? (avatarUrlDark ?? avatarUrlLight)
      : (avatarUrlLight ?? avatarUrlDark);
  const showFallback = !activeAvatarUrl || avatarStatusByUrl[activeAvatarUrl] !== "loaded";

  const updateAvatarStatus = (url: string, status: AvatarStatus) => {
    setAvatarStatusByUrl((current) => {
      if (current[url] === status) return current;
      return { ...current, [url]: status };
    });
  };

  return (
    <div
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-medium text-muted-foreground",
        showFallback && "bg-muted/80",
        className,
      )}
    >
      {showFallback ? <span className={labelClassName}>{fallbackLabel}</span> : null}

      {hasAvatar && isSameUrl && avatarUrlLight ? (
        <Image
          alt=""
          aria-hidden="true"
          className={cn("absolute inset-0 size-full object-cover", showFallback && "opacity-0")}
          fill
          onError={() => {
            updateAvatarStatus(avatarUrlLight, "error");
          }}
          onLoad={() => {
            updateAvatarStatus(avatarUrlLight, "loaded");
          }}
          sizes="40px"
          src={avatarUrlLight}
        />
      ) : null}

      {hasAvatar && !isSameUrl && avatarUrlLight ? (
        <Image
          alt=""
          aria-hidden="true"
          className={cn(
            "absolute inset-0 size-full object-cover dark:hidden",
            showFallback && "opacity-0",
          )}
          fill
          onError={() => {
            updateAvatarStatus(avatarUrlLight, "error");
          }}
          onLoad={() => {
            updateAvatarStatus(avatarUrlLight, "loaded");
          }}
          sizes="40px"
          src={avatarUrlLight}
        />
      ) : null}

      {hasAvatar && !isSameUrl && avatarUrlDark ? (
        <Image
          alt=""
          aria-hidden="true"
          className={cn(
            "absolute inset-0 hidden size-full object-cover dark:block",
            showFallback && "opacity-0",
          )}
          fill
          onError={() => {
            updateAvatarStatus(avatarUrlDark, "error");
          }}
          onLoad={() => {
            updateAvatarStatus(avatarUrlDark, "loaded");
          }}
          sizes="40px"
          src={avatarUrlDark}
        />
      ) : null}
    </div>
  );
};
