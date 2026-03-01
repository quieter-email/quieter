import { cn } from "@quietr/ui";
import { Show } from "solid-js";

type SenderAvatarProps = {
  avatarUrl?: string;
  fallbackLabel: string;
};

export const SenderAvatar = (props: SenderAvatarProps) => {
  return (
    <div
      class={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden bg-muted text-sm font-medium text-muted-foreground",
        {
          "bg-muted": !props.avatarUrl,
        },
      )}
    >
      <span>{props.fallbackLabel}</span>
      <Show when={props.avatarUrl} keyed={true}>
        {(url) => (
          <img
            src={url}
            alt=""
            class="absolute inset-0 size-full object-cover"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
      </Show>
    </div>
  );
};
