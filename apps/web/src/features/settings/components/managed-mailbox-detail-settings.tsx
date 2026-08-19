"use client";

import { cn } from "@quieter/ui/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";

import { MailboxAccessPill } from "#/features/mailbox/components/mailbox-access-pill";
import type { MailboxGrantRole } from "#/features/mailbox/components/mailbox-access-pill";
import {
  getMutationErrorMessage,
  mailboxGrantRoleOptions,
  mailboxGrantSelectItems,
  parseMailboxGrantRole,
} from "#/features/settings/components/mailboxes-settings-shared";
import {
  SettingsCard,
  SettingsInsetRows,
  SettingsSection,
  settingsSurfaceVariants,
} from "#/features/settings/components/settings-layout";

type ManagedMailboxDetails = {
  directGrants: { role: MailboxGrantRole; userId: string }[];
  divisionGrants: { divisionId: string; role: MailboxGrantRole }[];
  mailbox: {
    autoLabelEnabled: boolean;
    displayName: string | null;
    divisionId: string | null;
    includeApiSentMessages: boolean;
    usefulDetailsEnabled: boolean;
  };
};

type OrganizationMember = {
  id: string;
  user: { email: string; name: string | null };
  userId: string;
};

type Division = {
  id: string;
  name: string;
};

const ManagedMailboxIntelligenceRow = ({
  autoLabelEnabled,
  autoLabelSwitchId,
  disabled,
  emailAddress,
  hasAutomationAccess,
  onAutoLabelChange,
  onUsefulDetailsChange,
  usefulDetailsEnabled,
  usefulDetailsSwitchId,
}: {
  autoLabelEnabled: boolean;
  autoLabelSwitchId: string;
  disabled: boolean;
  emailAddress: string;
  hasAutomationAccess: boolean;
  onAutoLabelChange: (enabled: boolean) => void;
  onUsefulDetailsChange: (enabled: boolean) => void;
  usefulDetailsEnabled: boolean;
  usefulDetailsSwitchId: string;
}) => (
  <SettingsSection
    description="Organize new messages and surface time-sensitive information for everyone using this inbox."
    title="Intelligence"
  >
    <SettingsCard>
      <SettingsInsetRows>
        <label
          className={cn(
            settingsSurfaceVariants({ variant: "insetRow" }),
            "cursor-pointer gap-3"
          )}
          htmlFor={usefulDetailsSwitchId}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-body text-fg">Useful details</span>
            <span className="mt-0.5 block text-caption/5 text-muted-fg">
              Show codes, deliveries, and deadlines above the inbox.
              {!hasAutomationAccess && " Requires Pro access for this team."}
            </span>
          </span>
          <Switch
            aria-label={`Find time-sensitive updates in new mail for ${emailAddress}`}
            checked={usefulDetailsEnabled}
            className="shrink-0"
            size="sm"
            disabled={disabled}
            id={usefulDetailsSwitchId}
            onCheckedChange={onUsefulDetailsChange}
          >
            <SwitchThumb />
          </Switch>
        </label>
        <label
          className={cn(
            settingsSurfaceVariants({ variant: "insetRow" }),
            "cursor-pointer gap-3"
          )}
          htmlFor={autoLabelSwitchId}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-body text-fg">Auto-label</span>
            <span className="mt-0.5 block text-caption/5 text-muted-fg">
              Label new Inbox mail using existing shared labels.
              {!hasAutomationAccess && " Requires Pro access for this team."}
            </span>
          </span>
          <Switch
            aria-label={`Automatically label new mail for ${emailAddress}`}
            checked={autoLabelEnabled}
            className="shrink-0"
            size="sm"
            disabled={disabled}
            id={autoLabelSwitchId}
            onCheckedChange={onAutoLabelChange}
          >
            <SwitchThumb />
          </Switch>
        </label>
      </SettingsInsetRows>
    </SettingsCard>
  </SettingsSection>
);

export const ManagedMailboxDetailSettings = ({
  detailManagedDivisions,
  detailManagedMembers,
  details,
  emailAddress,
  hasAutomationAccess,
  includeApiMessagesSwitchId,
  isUpdatePending,
  mailboxId,
  onAutoLabelChange,
  onDivisionGrantChange,
  onMemberGrantChange,
  onUpdateMailbox,
  onUsefulDetailsChange,
}: {
  detailManagedDivisions: Division[];
  detailManagedMembers: OrganizationMember[];
  details: ManagedMailboxDetails;
  emailAddress: string;
  hasAutomationAccess: boolean;
  includeApiMessagesSwitchId: string;
  isUpdatePending: boolean;
  mailboxId: string;
  onAutoLabelChange: (enabled: boolean) => void;
  onDivisionGrantChange: (
    divisionId: string,
    role: MailboxGrantRole | null
  ) => void;
  onMemberGrantChange: (userId: string, role: MailboxGrantRole | null) => void;
  onUpdateMailbox: (input: {
    displayName?: string;
    divisionId?: string | null;
    includeApiSentMessages?: boolean;
  }) => void;
  onUsefulDetailsChange: (enabled: boolean) => void;
}) => {
  const usefulDetailsSwitchId = `managed-useful-details-${mailboxId}`;
  const autoLabelSwitchId = `managed-auto-label-${mailboxId}`;

  return (
    <>
      <SettingsSection
        description="Set the name, primary division, and which messages appear in this inbox."
        title="Shared inbox"
      >
        <SettingsCard>
          <SettingsInsetRows>
            <div
              className={cn(
                settingsSurfaceVariants({ variant: "insetRow" }),
                "gap-4"
              )}
            >
              <span className="min-w-0 flex-1 text-body text-fg">
                Display name
              </span>
              <TextFieldInput
                aria-label="Shared inbox display name"
                className="max-w-64"
                defaultValue={details.mailbox.displayName ?? ""}
                key={`${mailboxId}-display-name`}
                onBlur={(event) => {
                  onUpdateMailbox({ displayName: event.currentTarget.value });
                }}
                placeholder="Display name"
              />
            </div>
            <div
              className={cn(
                settingsSurfaceVariants({ variant: "insetRow" }),
                "gap-4"
              )}
            >
              <span className="min-w-0 flex-1 text-body text-fg">
                Primary division
              </span>
              <Select
                items={[
                  { label: "Unassigned", value: "none" },
                  ...detailManagedDivisions.map((division) => ({
                    label: division.name,
                    value: division.id,
                  })),
                ]}
                onValueChange={(value) => {
                  onUpdateMailbox({
                    divisionId: value === "none" ? null : value,
                  });
                }}
                value={details.mailbox.divisionId ?? "none"}
              >
                <SelectTrigger
                  aria-label="Primary division"
                  pending={isUpdatePending}
                  size="sm"
                  variant="ghost"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="none">Unassigned</SelectItem>
                  {detailManagedDivisions.map((division) => (
                    <SelectItem key={division.id} value={division.id}>
                      {division.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label
              className={cn(
                settingsSurfaceVariants({ variant: "insetRow" }),
                "cursor-pointer gap-3"
              )}
              htmlFor={includeApiMessagesSwitchId}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body text-fg">
                  Include API messages
                </span>
                <span className="mt-0.5 block text-caption/5 text-muted-fg">
                  Also show messages sent from this exact address through the
                  team API.
                </span>
              </span>
              <Switch
                aria-label={`Show API messages sent from ${emailAddress}`}
                checked={details.mailbox.includeApiSentMessages}
                className="shrink-0"
                size="sm"
                id={includeApiMessagesSwitchId}
                onCheckedChange={(includeApiSentMessages) => {
                  onUpdateMailbox({ includeApiSentMessages });
                }}
              >
                <SwitchThumb />
              </Switch>
            </label>
          </SettingsInsetRows>
        </SettingsCard>
      </SettingsSection>

      <ManagedMailboxIntelligenceRow
        autoLabelEnabled={details.mailbox.autoLabelEnabled}
        autoLabelSwitchId={autoLabelSwitchId}
        disabled={!hasAutomationAccess}
        emailAddress={emailAddress}
        hasAutomationAccess={hasAutomationAccess}
        onAutoLabelChange={onAutoLabelChange}
        onUsefulDetailsChange={onUsefulDetailsChange}
        usefulDetailsEnabled={details.mailbox.usefulDetailsEnabled}
        usefulDetailsSwitchId={usefulDetailsSwitchId}
      />

      <SettingsSection
        description="Give an entire division the same level of access to this inbox."
        title="Division access"
      >
        <SettingsCard>
          {detailManagedDivisions.length > 0 ? (
            <SettingsInsetRows>
              {detailManagedDivisions.map((division) => {
                const grant = details.divisionGrants.find(
                  (item) => item.divisionId === division.id
                );
                return (
                  <div
                    className={cn(
                      settingsSurfaceVariants({ variant: "insetRow" }),
                      "gap-3"
                    )}
                    key={division.id}
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-fg">
                      {division.name}
                    </span>
                    <Select
                      items={mailboxGrantSelectItems}
                      onValueChange={(value) => {
                        if ((value ?? "") === "" || value === "none") {
                          onDivisionGrantChange(division.id, null);
                          return;
                        }
                        const role = parseMailboxGrantRole(value ?? "");
                        if (role === null) {
                          return;
                        }
                        onDivisionGrantChange(division.id, role);
                      }}
                      value={grant?.role ?? "none"}
                    >
                      <SelectTrigger
                        aria-label={`${division.name} mailbox role`}
                        size="sm"
                        variant="ghost"
                      >
                        {grant ? (
                          <MailboxAccessPill role={grant.role} />
                        ) : (
                          <span className="text-muted-fg">No access</span>
                        )}
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="none">No access</SelectItem>
                        {mailboxGrantRoleOptions.map((role) => (
                          <SelectItem key={role.value} value={role.value}>
                            <MailboxAccessPill role={role.value} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </SettingsInsetRows>
          ) : (
            <p className="p-6 text-body text-muted-fg">
              This team has no divisions yet.
            </p>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        description="Override division access for an individual team member."
        title="Direct member access"
      >
        <SettingsCard>
          <SettingsInsetRows>
            {detailManagedMembers.map((member) => {
              const grant = details.directGrants.find(
                (item) => item.userId === member.userId
              );
              const trimmedName = member.user.name?.trim() ?? "";
              const memberName =
                trimmedName === "" ? member.user.email : member.user.name;
              return (
                <div
                  className={cn(
                    settingsSurfaceVariants({ variant: "insetRow" }),
                    "gap-3"
                  )}
                  key={member.id}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-fg">
                      {memberName}
                    </span>
                    <span className="block truncate text-caption text-muted-fg">
                      {member.user.email}
                    </span>
                  </span>
                  <Select
                    items={mailboxGrantSelectItems}
                    onValueChange={(value) => {
                      if ((value ?? "") === "" || value === "none") {
                        onMemberGrantChange(member.userId, null);
                        return;
                      }
                      const role = parseMailboxGrantRole(value ?? "");
                      if (role === null) {
                        return;
                      }
                      onMemberGrantChange(member.userId, role);
                    }}
                    value={grant?.role ?? "none"}
                  >
                    <SelectTrigger
                      aria-label={`${member.user.email} mailbox role`}
                      size="sm"
                      variant="ghost"
                    >
                      {grant ? (
                        <MailboxAccessPill role={grant.role} />
                      ) : (
                        <span className="text-muted-fg">No access</span>
                      )}
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="none">No access</SelectItem>
                      {mailboxGrantRoleOptions.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          <MailboxAccessPill role={role.value} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </SettingsInsetRows>
        </SettingsCard>
      </SettingsSection>
    </>
  );
};

export const showManagedMailboxMutationError =
  (fallback: string) => (error: unknown) => {
    toast.error(getMutationErrorMessage(error, fallback));
  };
