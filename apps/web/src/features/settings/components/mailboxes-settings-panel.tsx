"use client";

import {
  Delete02Icon,
  Loading03Icon,
  Mail01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MailboxSettingsRow } from "~/features/navigation/components/mailbox-switcher";
import { authClient } from "~/lib/auth";
import { getErrorMessage } from "~/lib/errors";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";

const PENDING_GMAIL_LINK_STORAGE_KEY = "quieter:pending-gmail-link";

type PendingGmailLinkState = {
  mailboxCount: number;
  startedAt: number;
};

const readPendingGmailLink = (): PendingGmailLinkState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(PENDING_GMAIL_LINK_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    if (
      typeof parsedValue !== "object" ||
      parsedValue === null ||
      typeof parsedValue.mailboxCount !== "number" ||
      typeof parsedValue.startedAt !== "number"
    ) {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
};

const writePendingGmailLink = (value: PendingGmailLinkState | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!value) {
    window.sessionStorage.removeItem(PENDING_GMAIL_LINK_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(PENDING_GMAIL_LINK_STORAGE_KEY, JSON.stringify(value));
};

export const MailboxesSettingsPanel = () => {
  const queryClient = useQueryClient();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pendingGmailLink, setPendingGmailLink] = useState<PendingGmailLinkState | null>(() =>
    readPendingGmailLink(),
  );
  const mailboxesQuery = useQuery(mailboxesQueryOptions());
  const groups = mailboxesQuery.data?.groups ?? [];
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const isGmailConnecting =
    pendingGmailLink != null && (mailboxesQuery.isPending || mailboxesQuery.isFetching);
  const defaultMailboxId = mailboxesQuery.data?.defaultMailboxId ?? null;
  const disconnectMailboxMutation = useMutation({
    ...orpc.mail.disconnectMailbox.mutationOptions(),
    mutationKey: ["mail", "disconnect-mailbox"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
    },
  });
  const setDefaultMailboxMutation = useMutation({
    ...orpc.mail.setDefaultMailbox.mutationOptions(),
    mutationKey: ["mail", "set-default-mailbox"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
    },
  });

  useEffect(() => {
    if (!pendingGmailLink) {
      return;
    }

    if (mailboxesQuery.isPending || mailboxesQuery.isFetching) {
      return;
    }

    writePendingGmailLink(null);
    setPendingGmailLink(null);

    if (mailboxesQuery.isError) {
      toast.error("Could not finish Gmail connection.");
      return;
    }

    if (mailboxes.length > pendingGmailLink.mailboxCount) {
      toast.success("Gmail connected.");
    }
  }, [
    mailboxes.length,
    mailboxesQuery.isError,
    mailboxesQuery.isFetching,
    mailboxesQuery.isPending,
    pendingGmailLink,
  ]);

  const handleConnectGmail = async () => {
    setConnectError(null);

    const nextPendingGmailLink = {
      mailboxCount: mailboxes.length,
      startedAt: Date.now(),
    } satisfies PendingGmailLinkState;

    writePendingGmailLink(nextPendingGmailLink);
    setPendingGmailLink(nextPendingGmailLink);

    try {
      await authClient.linkSocial({
        callbackURL: "/settings?tab=mailboxes",
        provider: "google",
      });
    } catch (error) {
      writePendingGmailLink(null);
      setPendingGmailLink(null);
      setConnectError(getErrorMessage(error, "Could not start Google account linking."));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={disconnectMailboxMutation.isPending || isGmailConnecting}
          onClick={() => {
            void handleConnectGmail();
          }}
          size="sm"
          type="button"
        >
          <HugeiconsIcon
            aria-hidden
            className={isGmailConnecting ? "size-4 animate-spin" : "size-4"}
            icon={isGmailConnecting ? Loading03Icon : Mail01Icon}
          />
          {isGmailConnecting ? "Connecting Gmail" : "Add Gmail"}
        </Button>
      </div>

      {isGmailConnecting && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          <span>syncing Gmail...</span>
        </div>
      )}

      {connectError && <p className="text-sm text-destructive">{connectError}</p>}

      {mailboxesQuery.isError && (
        <p className="text-sm text-destructive">
          {getErrorMessage(mailboxesQuery.error, "Could not load mailboxes.")}
        </p>
      )}

      {!mailboxesQuery.isError && !isGmailConnecting && mailboxesQuery.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          <span>loading mailboxes...</span>
        </div>
      )}

      {!mailboxesQuery.isPending && !mailboxesQuery.isError && mailboxes.length === 0 && (
        <p className="text-sm text-muted-foreground">No mailboxes connected yet.</p>
      )}

      {groups.map((group) => (
        <section className="space-y-2" key={group.id}>
          <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
            {group.name}
          </p>

          {group.mailboxes.length > 0 ? (
            <div className="divide-y divide-border/70">
              {group.mailboxes.map((mailbox) => {
                const isDisconnecting =
                  disconnectMailboxMutation.variables?.mailboxId === mailbox.id;
                const isDefault = mailbox.id === defaultMailboxId;
                const isGmailMailbox = mailbox.provider === "gmail";

                return (
                  <MailboxSettingsRow
                    action={
                      <div className="flex items-center gap-1">
                        <Button
                          aria-label={
                            isDefault ? "Unset default mailbox" : "Set as default mailbox"
                          }
                          className={cn({
                            "text-foreground": isDefault,
                            "text-muted-foreground": !isDefault,
                          })}
                          disabled={setDefaultMailboxMutation.isPending}
                          onClick={() => {
                            void setDefaultMailboxMutation.mutateAsync({
                              mailboxId: isDefault ? null : mailbox.id,
                            });
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <HugeiconsIcon
                            aria-hidden
                            className="size-4"
                            icon={isDefault ? PinIcon : PinOffIcon}
                          />
                          {isDefault ? "Default" : "Set default"}
                        </Button>

                        {isGmailMailbox && (
                          <Button
                            disabled={disconnectMailboxMutation.isPending || isGmailConnecting}
                            onClick={() => {
                              void disconnectMailboxMutation.mutateAsync({ mailboxId: mailbox.id });
                            }}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <HugeiconsIcon
                              aria-hidden
                              className={cn("size-4", { "animate-spin": isDisconnecting })}
                              icon={isDisconnecting ? Loading03Icon : Delete02Icon}
                            />
                            Remove
                          </Button>
                        )}
                      </div>
                    }
                    key={mailbox.id}
                    mailbox={mailbox}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No mailboxes in this group.</p>
          )}
        </section>
      ))}

      {disconnectMailboxMutation.isError && (
        <p className="text-sm text-destructive">
          {getErrorMessage(disconnectMailboxMutation.error, "Could not disconnect that mailbox.")}
        </p>
      )}
    </div>
  );
};
