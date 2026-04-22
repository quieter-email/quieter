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
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  MailboxSettingsRow,
  OrganizationSwitcherSelect,
} from "~/features/navigation/components/mailbox-switcher";
import { authClient } from "~/lib/auth";
import { getErrorMessage } from "~/lib/errors";
import { getGoogleScopeRepairPageHref } from "~/lib/google-scope-repair";
import { mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";

const PENDING_GMAIL_LINK_STORAGE_KEY = "quieter:pending-gmail-link";

type PendingGmailLinkState = {
  mailboxCount: number;
  organizationId: string;
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
      typeof parsedValue.organizationId !== "string" ||
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
  const sessionState = authClient.useSession();
  const activeOrganizationState = authClient.useActiveOrganization();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pendingGmailLink, setPendingGmailLink] = useState<PendingGmailLinkState | null>(() =>
    readPendingGmailLink(),
  );
  const activeOrganization = activeOrganizationState.data ?? null;
  const activeOrganizationId = activeOrganization?.id ?? null;
  const sessionUserId = sessionState.data?.user.id ?? null;
  const isPersonalOrganization =
    activeOrganization?.personalOwnerUserId != null &&
    activeOrganization.personalOwnerUserId === sessionUserId;
  const mailboxesQuery = useQuery(mailboxesQueryOptions(activeOrganizationId));
  const mailboxes = mailboxesQuery.data?.mailboxes ?? [];
  const googleScopeRepairTarget = mailboxesQuery.data?.googleScopeRepairTarget ?? null;
  const pendingGmailLinkMatchesOrganization =
    pendingGmailLink != null && pendingGmailLink.organizationId === activeOrganizationId;
  const isGmailConnecting =
    pendingGmailLinkMatchesOrganization && (mailboxesQuery.isPending || mailboxesQuery.isFetching);
  const googleScopeRepairHref = googleScopeRepairTarget
    ? getGoogleScopeRepairPageHref({
        from: "/settings?tab=mailboxes",
        targetAccountId: googleScopeRepairTarget.providerAccountId,
      })
    : null;
  const defaultMailboxId = mailboxesQuery.data?.defaultMailboxId ?? null;
  const disconnectMailboxMutation = useMutation({
    ...orpc.mail.disconnectMailbox.mutationOptions(),
    mutationKey: ["mail", "disconnect-mailbox"],
    onSuccess: async () => {
      if (!activeOrganizationId) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: ["mailboxes", activeOrganizationId],
      });
    },
  });
  const setDefaultMailboxMutation = useMutation({
    ...orpc.mail.setDefaultMailbox.mutationOptions(),
    mutationKey: ["mail", "set-default-mailbox"],
    onSuccess: async () => {
      if (!activeOrganizationId) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: ["mailboxes", activeOrganizationId],
      });
    },
  });

  useEffect(() => {
    setPendingGmailLink(readPendingGmailLink());
  }, [activeOrganizationId]);

  useEffect(() => {
    if (!pendingGmailLink || pendingGmailLink.organizationId !== activeOrganizationId) {
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
    activeOrganizationId,
    mailboxes.length,
    mailboxesQuery.isError,
    mailboxesQuery.isFetching,
    mailboxesQuery.isPending,
    pendingGmailLink,
  ]);

  const handleConnectGmail = async () => {
    if (!activeOrganizationId || !isPersonalOrganization) {
      return;
    }

    setConnectError(null);

    const nextPendingGmailLink = {
      mailboxCount: mailboxes.length,
      organizationId: activeOrganizationId,
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

  if (!activeOrganization) {
    return <p className="text-sm text-muted-foreground">loading organization...</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-64">
          <OrganizationSwitcherSelect />
        </div>

        {isPersonalOrganization && googleScopeRepairHref ? (
          <Link
            className="inline-flex h-8 items-center justify-center rounded-md border border-primary bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            to={googleScopeRepairHref}
          >
            Reconnect {googleScopeRepairTarget?.emailAddress}
          </Link>
        ) : null}

        {isPersonalOrganization && !googleScopeRepairHref ? (
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
        ) : null}
      </div>

      {googleScopeRepairTarget ? (
        <p className="text-sm text-muted-foreground">
          {googleScopeRepairTarget.emailAddress} needs Google permissions. Reconnect that mailbox.
          Reconnecting a different mailbox will not fix it.
        </p>
      ) : null}

      {!isPersonalOrganization ? (
        <p className="text-sm text-muted-foreground">Gmail lives in your personal organization.</p>
      ) : null}

      {isGmailConnecting ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          <span>syncing Gmail...</span>
        </div>
      ) : null}

      {connectError ? <p className="text-sm text-destructive">{connectError}</p> : null}

      {mailboxesQuery.isError ? (
        <p className="text-sm text-destructive">
          {mailboxesQuery.error.message || "Could not load mailboxes."}
        </p>
      ) : null}

      {!mailboxesQuery.isError && !isGmailConnecting && mailboxesQuery.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          <span>loading mailboxes...</span>
        </div>
      ) : null}

      {!mailboxesQuery.isPending && !mailboxesQuery.isError && mailboxes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isPersonalOrganization ? "No mailboxes yet." : "No mailboxes in this organization."}
        </p>
      ) : null}

      {mailboxes.length > 0 ? (
        <div className="divide-y divide-border/70">
          {mailboxes.map((mailbox) => {
            const isDisconnecting = disconnectMailboxMutation.variables?.mailboxId === mailbox.id;
            const isDefault = mailbox.id === defaultMailboxId;

            return (
              <MailboxSettingsRow
                action={
                  <div className="flex items-center gap-1">
                    <Button
                      aria-label={isDefault ? "Unset default mailbox" : "Set as default mailbox"}
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

                    {isPersonalOrganization ? (
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
                    ) : null}
                  </div>
                }
                key={mailbox.id}
                mailbox={mailbox}
              />
            );
          })}
        </div>
      ) : null}

      {disconnectMailboxMutation.isError ? (
        <p className="text-sm text-destructive">
          {getErrorMessage(disconnectMailboxMutation.error, "Could not disconnect that mailbox.")}
        </p>
      ) : null}
    </div>
  );
};
