"use client";

import {
  SettingsCard,
  SettingsInsetRows,
  SettingsRowText,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import type { RouterOutputs } from "@quieter/orpc";
import { Pill } from "@quieter/ui/pill";

type ActionsSettings = RouterOutputs["mailAgent"]["get"];
type ActionsRevision = NonNullable<ActionsSettings["draft"]>;

const operationLabels = {
  delete: "Delete",
  read: "Read",
  send: "Send",
  write: "Create or update",
};

export const getActionsTriggerLabel = (
  trigger: ActionsRevision["specification"]["trigger"]
) => {
  switch (trigger.kind) {
    case "manual": {
      return "When you run it on a thread";
    }
    case "mail_received": {
      return "When new mail arrives";
    }
    case "scheduled": {
      const { schedule } = trigger;
      return schedule.cadence === "daily"
        ? `Daily at ${schedule.localTime}, ${schedule.timeZone}`
        : `Every ${schedule.dayOfWeek} at ${schedule.localTime}, ${schedule.timeZone}`;
    }
    case "future_event": {
      return "On an event";
    }
    default: {
      const exhaustive: never = trigger;
      return exhaustive;
    }
  }
};

export const MailboxActionsReview = ({
  accounts,
  revision,
}: {
  accounts: ActionsSettings["accounts"];
  revision: ActionsRevision;
}) => {
  const { specification } = revision;
  const accountLabels = new Map(
    accounts.map((account) => [account.connectionId, account.label])
  );
  const referenceLabels = new Map(
    specification.connectors.map((connector) => [
      connector.referenceId,
      accountLabels.get(connector.connectionId) ?? "Unavailable account",
    ])
  );

  return (
    <SettingsCard>
      <SettingsInsetRows>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-body font-medium text-fg">Review</h3>
            <Pill tone={revision.canActivate ? "success" : "orange"}>
              {revision.canActivate ? "Ready to activate" : "Needs attention"}
            </Pill>
          </div>
          <p className="text-body text-fg">{specification.review.summary}</p>
          <p className="text-caption text-muted-fg">
            Check the instructions and access below. Edit your instructions and
            review again to correct anything.
          </p>
        </div>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <SettingsRowText title="When it runs">
            {getActionsTriggerLabel(specification.trigger)}
          </SettingsRowText>
          {specification.trigger.kind === "scheduled" ? (
            <p className="text-body-sm text-warning">
              Scheduled actions are not available yet. This review stays
              inactive.
            </p>
          ) : null}
          {specification.trigger.kind === "future_event" ? (
            <p className="text-body-sm text-warning">
              Event actions are not available yet. This review stays inactive.
            </p>
          ) : null}
          <SettingsRowText title="Instructions">
            <p className="whitespace-pre-wrap">{specification.instructions}</p>
          </SettingsRowText>
        </div>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <SettingsRowText title="Connected accounts">
            {specification.connectors.length === 0
              ? "No connected accounts required."
              : null}
          </SettingsRowText>
          {specification.connectors.length > 0 ? (
            <ul className="space-y-1 text-body-sm text-fg">
              {specification.connectors.map((connector) => (
                <li key={connector.referenceId}>
                  {accountLabels.get(connector.connectionId) ??
                    "Unavailable account"}
                </li>
              ))}
            </ul>
          ) : null}
          <SettingsRowText title="Allowed tools">
            {revision.capabilities.length === 0
              ? "No tools are available for this review."
              : null}
          </SettingsRowText>
          {revision.capabilities.length > 0 ? (
            <ul className="space-y-2 text-body-sm text-fg">
              {revision.capabilities.map((capability) => (
                <li
                  key={`${capability.toolId}:${capability.accountLabel ?? "mailbox"}`}
                >
                  <p>{capability.label}</p>
                  <p className="text-caption text-muted-fg">
                    {operationLabels[capability.operation]}
                    {capability.accountLabel
                      ? `, ${capability.accountLabel}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          <SettingsRowText title="Permissions">
            {specification.permissions.length === 0
              ? "No additional permissions requested."
              : null}
          </SettingsRowText>
          {specification.permissions.length > 0 ? (
            <ul className="space-y-1 text-body-sm text-fg">
              {specification.permissions.map((permission) => {
                let target =
                  permission.scope === "mailbox"
                    ? "this mailbox"
                    : "your saved preferences";
                if (permission.scope === "connector") {
                  target =
                    referenceLabels.get(permission.connectorReferenceId) ??
                    "Unavailable account";
                }
                return (
                  <li key={permission.id}>
                    {operationLabels[permission.operation]}, {target}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        {specification.review.assumptions.length > 0 ? (
          <div className={settingsSurfaceVariants({ variant: "body" })}>
            <SettingsRowText title="Assumptions to confirm" />
            <ul className="list-disc space-y-1 pl-4 text-body-sm text-fg">
              {specification.review.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {specification.review.questions.length > 0 ? (
          <div className={settingsSurfaceVariants({ variant: "body" })}>
            <SettingsRowText title="Questions to resolve" />
            <ul className="list-disc space-y-1 pl-4 text-body-sm text-fg">
              {specification.review.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {revision.blockingReasons.length > 0 ? (
          <div className={settingsSurfaceVariants({ variant: "body" })}>
            <SettingsRowText title="Before activation" />
            <ul className="list-disc space-y-1 pl-4 text-body-sm text-warning">
              {revision.blockingReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </SettingsInsetRows>
    </SettingsCard>
  );
};
