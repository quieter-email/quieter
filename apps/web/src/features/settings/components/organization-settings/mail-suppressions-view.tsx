"use client";

import { cn } from "@quieter/ui/cn";
import { Pill } from "@quieter/ui/pill";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  SettingsBackButton,
  SettingsCard,
  SettingsLoadingState,
  SettingsRow,
  SettingsRows,
  settingsSurfaceVariants,
} from "../settings-layout";
import type { FullOrganization } from "./domain";
import { organizationMailSuppressionsQueryOptions } from "./mail-suppressions";

const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

const REASON_LABELS = {
  bounce: "Permanent bounce",
  complaint: "Spam complaint",
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
  const {
    data: suppressions,
    error: suppressionsError,
    isError: isSuppressionsError,
    isPending: isSuppressionsPending,
  } = useQuery({
    ...organizationMailSuppressionsQueryOptions(organization.id),
    enabled: canViewSuppressions,
  });

  const suppressionRows = suppressions ?? [];

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
  } else if (suppressionRows.length > 0) {
    suppressionsContent = (
      <SettingsRows>
        {suppressionRows.map((suppression) => (
          <SettingsRow
            action={
              <Pill
                tone={suppression.reason === "complaint" ? "red" : "orange"}
              >
                {REASON_LABELS[suppression.reason]}
              </Pill>
            }
            key={suppression.recipient}
            title={suppression.recipient}
          >
            <span className="block">
              Blocked since {dateFormatter.format(suppression.createdAt)}
            </span>
            <span className="mt-0.5 block truncate font-mono text-caption text-muted-fg">
              From message {suppression.sourceProviderMessageId}
            </span>
          </SettingsRow>
        ))}
      </SettingsRows>
    );
  } else {
    suppressionsContent = (
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
          These addresses bounced permanently or reported a message as spam. New
          messages to them are stopped before another delivery attempt, which
          keeps this team able to reach everyone else.
        </p>
      </div>

      {suppressionsContent}
    </div>
  );
};
