"use client";

import {
  BanIcon,
  Delete02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Pill } from "@quieter/ui/pill";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { z } from "zod";

import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";

import {
  SettingsBackButton,
  SettingsCard,
  SettingsLoadingState,
  SettingsRow,
  SettingsRows,
  settingsSurfaceVariants,
} from "../settings-layout";
import type { FullOrganization } from "./domain";
import {
  getOrganizationMailSuppressionAuditQueryKey,
  getOrganizationMailSuppressionsQueryKey,
  organizationMailSuppressionAuditQueryOptions,
  organizationMailSuppressionsQueryOptions,
} from "./mail-suppressions";

const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

const REASON_LABELS = {
  bounce: "Permanent bounce",
  complaint: "Spam complaint",
  manual: "Manually blocked",
  unsubscribe: "Unsubscribed",
} as const;

const REASON_TONES = {
  bounce: "orange",
  complaint: "red",
  manual: "gray",
  unsubscribe: "blue",
} as const;

const ACTION_LABELS = {
  suppressed: "Blocked",
  unsuppressed: "Unblocked",
} as const;

export const MailSuppressionsView = ({
  canViewSuppressions,
  onBack,
  organization,
}: {
  canViewSuppressions: boolean;
  onBack: () => void;
  organization: FullOrganization;
}) => {
  const queryClient = useQueryClient();
  const addressErrorId = useId();
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getOrganizationMailSuppressionsQueryKey(organization.id),
      }),
      queryClient.invalidateQueries({
        queryKey: getOrganizationMailSuppressionAuditQueryKey(organization.id),
      }),
    ]);
  };

  const blockMutation = useMutation(
    orpc.organization.suppressMailRecipient.mutationOptions({
      onError: (error) => {
        toastError(error);
      },
      onSuccess: async () => {
        setAddress("");
        await invalidate();
      },
    })
  );
  const unblockMutation = useMutation(
    orpc.organization.unsuppressMailRecipient.mutationOptions({
      onError: (error) => {
        toastError(error);
      },
      onSuccess: async (_data, variables) => {
        toast.success(
          `${variables.recipient} can receive mail from this team again.`
        );
        await invalidate();
      },
    })
  );
  const {
    data: suppressions,
    error: suppressionsError,
    isError: isSuppressionsError,
    isPending: isSuppressionsPending,
  } = useQuery({
    ...organizationMailSuppressionsQueryOptions(organization.id),
    enabled: canViewSuppressions,
  });

  const { data: auditEntries } = useQuery({
    ...organizationMailSuppressionAuditQueryOptions(organization.id),
    enabled: canViewSuppressions,
  });

  const submitBlock = () => {
    const parsed = z.email().safeParse(address.trim());
    if (!parsed.success) {
      setAddressError("Enter a valid email address.");
      return;
    }
    setAddressError(null);
    blockMutation.mutate({
      organizationId: organization.id,
      recipient: parsed.data.toLowerCase(),
    });
  };

  const suppressionRows = suppressions ?? [];
  const recentChanges = (auditEntries ?? []).slice(0, 5);

  let suppressionsContent: ReactNode;
  if (!canViewSuppressions) {
    suppressionsContent = (
      <SettingsCard>
        <p
          className={cn(
            "text-body text-muted-fg",
            settingsSurfaceVariants({ variant: "padding" })
          )}
        >
          Only admins and owners can see blocked recipients.
        </p>
      </SettingsCard>
    );
  } else if (isSuppressionsPending) {
    suppressionsContent = (
      <SettingsLoadingState label="Loading blocked recipients" />
    );
  } else if (isSuppressionsError) {
    suppressionsContent = (
      <p
        className={cn(
          "text-body text-destructive",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        {suppressionsError?.message ?? "Could not load blocked recipients."}
      </p>
    );
  } else {
    suppressionsContent = (
      <div className="space-y-3">
        <form
          className={cn(
            settingsSurfaceVariants({ variant: "insetFieldRow" }),
            "gap-3"
          )}
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            submitBlock();
          }}
        >
          <TextField className="min-w-0 flex-1">
            <TextFieldInput
              aria-describedby={
                addressError === null ? undefined : addressErrorId
              }
              aria-invalid={addressError !== null}
              chrome="ghost"
              className="h-9 px-0"
              name="recipient"
              onChange={(changeEvent) => {
                setAddressError(null);
                setAddress(changeEvent.target.value);
              }}
              placeholder="name@example.com"
              value={address}
            />
          </TextField>
          <Button
            className="shrink-0 @md:w-28"
            disabled={blockMutation.isPending || address.trim() === ""}
            type="submit"
          >
            {blockMutation.isPending ? (
              <HugeiconsIcon
                aria-hidden
                className="size-4 animate-spin"
                icon={Loading03Icon}
              />
            ) : (
              <HugeiconsIcon aria-hidden className="size-4" icon={BanIcon} />
            )}
            Block
          </Button>
        </form>
        {addressError !== null && (
          <p
            className="px-4 text-body text-destructive"
            id={addressErrorId}
            role="alert"
          >
            {addressError}
          </p>
        )}

        {suppressionRows.length > 0 ? (
          <SettingsRows>
            {suppressionRows.map((suppression) => (
              <SettingsRow
                action={
                  <div className="flex shrink-0 items-center gap-2">
                    <Pill tone={REASON_TONES[suppression.reason]}>
                      {REASON_LABELS[suppression.reason]}
                    </Pill>
                    <Button
                      aria-label={`Unblock ${suppression.recipient}`}
                      disabled={unblockMutation.isPending}
                      onClick={() => {
                        unblockMutation.mutate({
                          organizationId: organization.id,
                          recipient: suppression.recipient,
                        });
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4"
                        icon={Delete02Icon}
                      />
                      Unblock
                    </Button>
                  </div>
                }
                key={suppression.recipient}
                title={suppression.recipient}
              >
                <span className="block">
                  Blocked since {dateFormatter.format(suppression.createdAt)}
                </span>
                {suppression.sourceProviderMessageId !== null && (
                  <span className="mt-0.5 block truncate font-mono text-caption text-muted-fg">
                    From message {suppression.sourceProviderMessageId}
                  </span>
                )}
              </SettingsRow>
            ))}
          </SettingsRows>
        ) : (
          <SettingsCard>
            <p
              className={cn(
                "text-center text-body text-muted-fg",
                settingsSurfaceVariants({ variant: "padding" })
              )}
            >
              No blocked recipients.
            </p>
          </SettingsCard>
        )}
      </div>
    );
  }

  return (
    <div className="@container space-y-6">
      <SettingsBackButton onClick={onBack}>
        {organization.name}
      </SettingsBackButton>

      <div>
        <h1 className="text-body-lg font-semibold text-fg">
          Blocked recipients
        </h1>
        <p className="mt-1 text-body text-muted-fg">
          These addresses bounced permanently, reported a message as spam,
          unsubscribed, or were blocked manually. New messages to them are
          stopped before another delivery attempt, which keeps this team able to
          reach everyone else.
        </p>
      </div>

      {suppressionsContent}

      {canViewSuppressions && recentChanges.length > 0 && (
        <section aria-label="Recent blocking changes">
          <h2 className="text-body font-semibold text-fg">Recent changes</h2>
          <p className="mt-1 mb-3 text-caption text-muted-fg">
            Every block and unblock is recorded, including automatic ones.
          </p>
          <SettingsRows>
            {recentChanges.map((entry) => (
              <SettingsRow
                action={
                  <Pill tone={REASON_TONES[entry.reason]}>
                    {REASON_LABELS[entry.reason]}
                  </Pill>
                }
                key={entry.id}
                title={`${ACTION_LABELS[entry.action]} ${entry.recipient}`}
              >
                <span className="block">
                  {entry.actorUserId === null
                    ? `${dateFormatter.format(entry.createdAt)}, automatic`
                    : `${dateFormatter.format(entry.createdAt)} by a team admin`}
                </span>
              </SettingsRow>
            ))}
          </SettingsRows>
        </section>
      )}
    </div>
  );
};
