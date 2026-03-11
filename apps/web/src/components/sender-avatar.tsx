"use client";

import { cn } from "@quietr/ui";
import { useState } from "react";

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
  const [showFallback, setShowFallback] = useState(!hasAvatar);
  const isSameUrl = avatarUrlLight && avatarUrlDark && avatarUrlLight === avatarUrlDark;

  return (
    <div
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-medium text-muted-foreground shadow-sm",
        showFallback && "bg-muted/80",
        className,
      )}
    >
      {showFallback ? <span className={labelClassName}>{fallbackLabel}</span> : null}

      {!showFallback && isSameUrl ? (
        <img
          alt="Sender Avatar"
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          onError={() => setShowFallback(true)}
          src={avatarUrlLight}
        />
      ) : null}

      {!showFallback && !isSameUrl && avatarUrlLight ? (
        <img
          alt="Sender Avatar"
          className="absolute inset-0 size-full object-cover dark:hidden"
          loading="lazy"
          onError={() => setShowFallback(true)}
          src={avatarUrlLight}
        />
      ) : null}

      {!showFallback && !isSameUrl && avatarUrlDark ? (
        <img
          alt=""
          aria-hidden="true"
          className="absolute inset-0 hidden size-full object-cover dark:block"
          loading="lazy"
          onError={() => setShowFallback(true)}
          src={avatarUrlDark}
        />
      ) : null}
    </div>
  );
};
