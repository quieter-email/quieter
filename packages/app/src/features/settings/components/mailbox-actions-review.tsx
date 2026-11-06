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
  shared,
}: {
  accounts: ActionsSettings["accounts"];
  revision: ActionsRevision;
  shared: boolean;
}) => {
  const { specification } = revision;
  const accountLabels = new Map(
    accounts.map((account) => [account.connectionId, account.label])
  );
  const accessGroups = [
    ...specification.connectors.map((connector) => ({
      id: `connector:${connector.referenceId}`,
      label: accountLabels.get(connector.connectionId) ?? "Unavailable account",
      permissions: specification.permissions.filter(
        (permission) =>
          permission.scope === "connector" &&
          permission.connectorReferenceId === connector.referenceId
      ),
      scope: "connector" as const,
    })),
    ...(["mailbox", "memory"] as const)
      .map((scope) => ({
        id: scope,
        label: scope === "mailbox" ? "This inbox" : "Your saved preferences",
        permissions: specification.permissions.filter(
          (permission) => permission.scope === scope
        ),
        scope,
      }))
      .filter((group) => group.permissions.length > 0),
  ];

  return (
    <SettingsCard>
      <SettingsInsetRows>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-body font-medium text-fg">
              Review your action
            </h3>
            <Pill tone={revision.canActivate ? "success" : "orange"}>
              {revision.canActivate ? "Ready to activate" : "Needs attention"}
            </Pill>
          </div>
          <p className="text-body text-fg">{specification.review.summary}</p>
          <p className="text-caption text-muted-fg">
            Check what your action can do before turning it on.
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
          {specification.eligibility ? (
            <SettingsRowText title="Required message conditions">
              <p>
                {specification.eligibility.sender.kind === "any"
                  ? "Any sender"
                  : `Sender must be ${specification.eligibility.sender.addresses.join(", ")}`}
              </p>
              {specification.eligibility.subjectIncludes.map((text) => (
                <p key={text}>Subject must contain {text}</p>
              ))}
              {specification.eligibility.bodyIncludes.map((text) => (
                <p key={text}>Body must contain {text}</p>
              ))}
              <p>Every condition must match the triggering message.</p>
            </SettingsRowText>
          ) : null}
        </div>
        {accessGroups.map((group) => (
          <div
            className={settingsSurfaceVariants({ variant: "body" })}
            key={group.id}
          >
            <h4 className="text-body-sm font-medium break-words text-fg">
              {group.label}
            </h4>
            <ul className="space-y-2 text-body-sm text-fg">
              {group.permissions.map((permission) => {
                const grants = specification.toolGrants.filter(
                  (grant) => grant.permissionId === permission.id
                );
                return (
                  <li className="space-y-2" key={permission.id}>
                    {grants.length === 0
                      ? operationLabels[permission.operation]
                      : null}
                    {grants.map((grant) => (
                      <div className="space-y-1" key={grant.toolId}>
                        <p>
                          {operationLabels[permission.operation]},{" "}
                          {revision.capabilities.find(
                            (capability) => capability.toolId === grant.toolId
                          )?.label ?? "Approved operation"}
                        </p>
                        {grant.argumentTemplate ? (
                          <details className="text-caption text-muted-fg">
                            <summary className="cursor-pointer">
                              Exact changes
                            </summary>
                            <p className="mt-2">
                              Runs once per matching message with these exact
                              arguments. Message placeholders copy only the
                              incoming subject or body.
                            </p>
                            <pre className="mt-2 break-words whitespace-pre-wrap text-fg">
                              {grant.argumentTemplate}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
            {group.permissions.length === 0 ? (
              <p className="text-body-sm text-muted-fg">
                No operations requested.
              </p>
            ) : null}
            {group.scope === "mailbox" &&
            shared &&
            specification.toolGrants.some(
              (grant) => grant.toolId === "mail.save_draft"
            ) ? (
              <p className="text-caption text-warning">
                Reply drafts saved in this shared inbox are visible to its
                members.
              </p>
            ) : null}
          </div>
        ))}
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <details className="text-body-sm text-muted-fg">
            <summary className="cursor-pointer">Reviewed instructions</summary>
            <p className="mt-2 whitespace-pre-wrap text-fg">
              {specification.instructions}
            </p>
          </details>
          {specification.connectors.length > 0 ? (
            <p className="text-caption text-muted-fg">
              Destination access follows the permissions of your connected app.
            </p>
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
