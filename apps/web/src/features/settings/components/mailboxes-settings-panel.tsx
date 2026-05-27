"use client";

import {
  Delete02Icon,
  Loading03Icon,
  Mail01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { REQUIRED_GOOGLE_SCOPES } from "@quieter/auth/google-scopes";
import { Button, cn, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MailboxSettingsRow } from "~/features/navigation/components/mailbox-switcher";
import { authClient } from "~/lib/auth";
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
  const [isStartingGmailLink, setIsStartingGmailLink] = useState(false);
  const mailboxesQuery = useQuery(mailboxesQueryOptions());
  const groups = mailboxesQuery.data?.groups ?? [];
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const isGmailConnecting = isStartingGmailLink || pendingGmailLink != null;
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
  useQuery({
    enabled: pendingGmailLink != null,
    queryKey: ["mailboxes", "finish-gmail-link", pendingGmailLink?.startedAt],
    queryFn: async () => {
      if (!pendingGmailLink) {
        return null;
      }

      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });

      const result = await mailboxesQuery.refetch({
        cancelRefetch: true,
      });

      if (result.isError) {
        toast.error("Could not finish Gmail connection.");
        return result;
      }

      writePendingGmailLink(null);
      setPendingGmailLink(null);

      const nextMailboxCount = result.data?.groups.flatMap((group) => group.mailboxes).length ?? 0;
      if (nextMailboxCount > pendingGmailLink.mailboxCount) {
        toast.success("Gmail connected.");
      }

      return result;
    },
  });

  const handleConnectGmail = async () => {
    setConnectError(null);

    const nextPendingGmailLink = {
      mailboxCount: mailboxes.length,
      startedAt: Date.now(),
    } satisfies PendingGmailLinkState;

    writePendingGmailLink(nextPendingGmailLink);
    setIsStartingGmailLink(true);

    try {
      const response = await authClient.linkSocial({
        callbackURL: "/settings?tab=mailboxes",
        disableRedirect: true,
        errorCallbackURL: "/settings?tab=mailboxes",
        provider: "google",
        scopes: [...REQUIRED_GOOGLE_SCOPES],
      });

      if (response.error) {
        writePendingGmailLink(null);
        setIsStartingGmailLink(false);
        setConnectError(response.error.message ?? "Could not start Google account linking.");
        return;
      }

      if (!response.data?.url) {
        writePendingGmailLink(null);
        setIsStartingGmailLink(false);
        setConnectError("Could not start Google account linking.");
        return;
      }

      const providerUrl = new URL(response.data.url);
      providerUrl.searchParams.set("prompt", "consent select_account");
      window.location.assign(providerUrl.toString());
    } catch (error) {
      writePendingGmailLink(null);
      setIsStartingGmailLink(false);
      setConnectError(
        (error as { message?: string })?.message ?? "Could not start Google account linking.",
      );
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
          <span>Syncing Gmail…</span>
        </div>
      )}

      {connectError && <p className="text-sm text-destructive">{connectError}</p>}

      {mailboxesQuery.isError && (
        <p className="text-sm text-destructive">
          {mailboxesQuery.error.message ?? "Could not load mailboxes."}
        </p>
      )}

      {!mailboxesQuery.isError && !isGmailConnecting && mailboxesQuery.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          <span>Loading mailboxes…</span>
        </div>
      )}

      {!mailboxesQuery.isPending && !mailboxesQuery.isError && mailboxes.length === 0 && (
        <p className="text-sm text-muted-foreground">No mailboxes connected yet.</p>
      )}

      {groups.map((group) => (
        <section className="space-y-2" key={group.id}>
          <p className="text-xs text-muted-foreground">{group.name}</p>

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
          {disconnectMailboxMutation.error.message ?? "Could not disconnect that mailbox."}
        </p>
      )}
    </div>
  );
};
