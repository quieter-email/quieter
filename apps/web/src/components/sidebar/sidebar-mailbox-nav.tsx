import { Button, cn } from "@quietr/ui";
import { For } from "solid-js";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { SIDEBAR_MAILBOX_ITEMS } from "./sidebar-constants";

type SidebarMailboxNavProps = {
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const SidebarMailboxNav = (props: SidebarMailboxNavProps) => (
  <nav class="flex flex-col gap-2 p-3" aria-label="Mailboxes">
    <For each={SIDEBAR_MAILBOX_ITEMS}>
      {(item) => {
        const Icon = item.icon;
        const isActive = () => props.selectedMailbox === item.id;

        return (
          <Button
            type="button"
            variant={isActive() ? "outline-dark" : "outline-light"}
            size="sm"
            aria-current={isActive() ? "page" : undefined}
            class={cn(
              "group relative h-10 w-full justify-start gap-3 px-3 text-left text-sm font-normal",
              {
                "font-semibold": isActive(),
              },
            )}
            onClick={() => {
              props.onSelectMailbox(item.id);
            }}
          >
            <Icon
              class={cn("size-4 shrink-0 transition-colors", {
                "stroke-[2.2] text-foreground": isActive(),
                "stroke-[1.9] text-muted-foreground group-hover:text-foreground": !isActive(),
              })}
            />
            <span>{item.label}</span>
          </Button>
        );
      }}
    </For>
  </nav>
);
