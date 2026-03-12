"use client";

import { cn } from "@quietr/ui";
import { useEffect, useState } from "react";

const isDarkMode = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark");

type SenderAvatarProps = {
  avatarUrlLight?: string;
  avatarUrlDark?: string;
  fallbackLabel: string;
  className?: string;
  labelClassName?: string;
};

export const SenderAvatar = ({
  avatarUrlDark,
  avatarUrlLight,
  className,
  fallbackLabel,
  labelClassName,
}: SenderAvatarProps) => {
  const hasAvatar = Boolean(avatarUrlLight || avatarUrlDark);
  const [showFallback, setShowFallback] = useState(true);
  const isSameUrl = avatarUrlLight && avatarUrlDark && avatarUrlLight === avatarUrlDark;

  useEffect(() => {
    if (hasAvatar) setShowFallback(true);
  }, [hasAvatar, avatarUrlLight, avatarUrlDark]);

  const handleLoad = () => setShowFallback(false);
  const handleErrorLight = () => {
    if (!isDarkMode()) setShowFallback(true);
  };
  const handleErrorDark = () => {
    if (isDarkMode()) setShowFallback(true);
  };

  return (
    <div
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-medium text-muted-foreground shadow-sm",
        showFallback && "bg-muted/80",
        className,
      )}
    >
      {showFallback ? <span className={labelClassName}>{fallbackLabel}</span> : null}

      {hasAvatar && isSameUrl && avatarUrlLight ? (
        <img
          alt="Sender Avatar"
          className={cn("absolute inset-0 size-full object-cover", showFallback && "opacity-0")}
          loading="lazy"
          onLoad={handleLoad}
          onError={() => setShowFallback(true)}
          src={avatarUrlLight}
        />
      ) : null}

      {hasAvatar && !isSameUrl && avatarUrlLight ? (
        <img
          alt="Sender Avatar"
          className={cn(
            "absolute inset-0 size-full object-cover dark:hidden",
            showFallback && "opacity-0",
          )}
          loading="lazy"
          onLoad={handleLoad}
          onError={handleErrorLight}
          src={avatarUrlLight}
        />
      ) : null}

      {hasAvatar && !isSameUrl && avatarUrlDark ? (
        <img
          alt=""
          aria-hidden="true"
          className={cn(
            "absolute inset-0 hidden size-full object-cover dark:block",
            showFallback && "opacity-0",
          )}
          loading="lazy"
          onLoad={handleLoad}
          onError={handleErrorDark}
          src={avatarUrlDark}
        />
      ) : null}
    </div>
  );
};
