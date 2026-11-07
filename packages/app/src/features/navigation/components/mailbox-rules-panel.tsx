"use client";

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Delete01Icon,
  Edit01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import type {
  RuleActionKind,
  MailboxOrganizerContentProps,
} from "@quieter/app/features/navigation/components/mailbox-organizer-types";
import {
  getManagedMailboxRuleActions,
  managedMailboxRuleConditionGroupSchema,
} from "@quieter/mail/mailbox-organization";
import type {
  ManagedMailboxRuleAction,
  ManagedMailboxRuleConditionGroup,
} from "@quieter/mail/mailbox-organization";
import {
  serializeStructuredSearchState,
  structuredMailSearchSchema,
} from "@quieter/mail/search";
import type { RouterOutputs } from "@quieter/orpc";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import {
  SettingsCard,
  SettingsSectionLayout,
  settingsSurfaceVariants,
} from "@quieter/ui/settings-layout";
import { Surface } from "@quieter/ui/surface";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { Toggle, ToggleGroup } from "@quieter/ui/toggle";

const getPrimaryRuleAction = (actions: readonly ManagedMailboxRuleAction[]) =>
  actions.find((action) => action.kind !== "stop-processing") ?? actions[0];

const getRuleActionLabel = (actions: readonly ManagedMailboxRuleAction[]) => {
  const action = getPrimaryRuleAction(actions);
  if (action === undefined) {
    return "No action";
  }
  if (action.kind === "set-labels") {
    return "Apply labels";
  }
  if (action.kind === "set-read") {
    return action.read ? "Mark read" : "Mark unread";
  }
  if (action.kind === "move") {
    return action.destination === "inbox"
      ? "Move to Inbox"
      : `Move to ${action.destination[0]?.toUpperCase()}${action.destination.slice(1)}`;
  }
  if (action.kind === "forward") {
    return `Forward to ${action.recipients.join(", ")}`;
  }
  return "Stop processing";
};

const getRuleConditionGroups = (conditionGroups: unknown) => {
  const parsed = managedMailboxRuleConditionGroupSchema
    .array()
    .safeParse(conditionGroups);
  return parsed.success ? parsed.data : undefined;
};

const hasInvalidRuleConditionGroups = (
  storedConditionGroups: unknown,
  conditionGroups: ManagedMailboxRuleConditionGroup[] | undefined
) =>
  storedConditionGroups !== null &&
  storedConditionGroups !== undefined &&
  conditionGroups === undefined;

type RuleInputValidityParams = {
  actionKind: RuleActionKind;
  forwardRecipients: string;
  name: string;
  query: string;
  selectedLabelIds: string[];
};

const hasValidRuleInput = ({
  actionKind,
  forwardRecipients,
  name,
  query,
  selectedLabelIds,
}: RuleInputValidityParams) => {
  if (name.trim().length === 0 || query.trim().length === 0) {
    return false;
  }
  if (actionKind === "set-labels" && selectedLabelIds.length === 0) {
    return false;
  }
  if (actionKind === "forward" && forwardRecipients.trim().length === 0) {
    return false;
  }
  return true;
};

const ManagedRuleActionEditor = (props: MailboxOrganizerContentProps) => {
  const {
    ruleActionKind,
    ruleForwardIncludesAttachments,
    ruleForwardRecipients,
    ruleMoveDestination,
    ruleReadState,
    ruleStopsProcessing,
    setRuleActionKind,
    setRuleForwardIncludesAttachments,
    setRuleForwardRecipients,
    setRuleMoveDestination,
    setRuleReadState,
    setRuleStopsProcessing,
  } = props;

  return (
    <div>
      <div className="space-y-2">
        <Text size="sm" weight="medium">
          Then
        </Text>
        <ToggleGroup
          aria-label="Rule action"
          className="grid grid-cols-2 sm:grid-cols-4"
          size="flush"
          variant="plain"
          value={[ruleActionKind]}
        >
          {(
            [
              ["set-labels", "Apply labels"],
              ["set-read", "Read state"],
              ["move", "Move"],
              ["forward", "Forward"],
            ] as const
          ).map(([kind, label]) => (
            <Toggle
              size="sm"
              key={kind}
              onClick={() => {
                setRuleActionKind(kind);
              }}
              type="button"
              value={kind}
            >
              {label}
            </Toggle>
          ))}
        </ToggleGroup>
        {ruleActionKind === "set-read" ? (
          <ToggleGroup
            aria-label="Read state"
            className="grid grid-cols-2"
            size="flush"
            variant="plain"
            value={[String(ruleReadState)]}
          >
            {[true, false].map((read) => (
              <Toggle
                size="sm"
                key={String(read)}
                onClick={() => {
                  setRuleReadState(read);
                }}
                type="button"
                value={String(read)}
              >
                {read ? "Mark read" : "Mark unread"}
              </Toggle>
            ))}
          </ToggleGroup>
        ) : null}
        {ruleActionKind === "move" ? (
          <ToggleGroup
            aria-label="Move destination"
            className="grid grid-cols-2"
            size="flush"
            variant="plain"
            value={[ruleMoveDestination]}
          >
            {(["archive", "inbox", "spam", "trash"] as const).map(
              (destination) => (
                <Toggle
                  size="sm"
                  key={destination}
                  onClick={() => {
                    setRuleMoveDestination(destination);
                  }}
                  type="button"
                  value={destination}
                >
                  {destination === "inbox"
                    ? "Move to Inbox"
                    : `Move to ${destination[0]?.toUpperCase()}${destination.slice(1)}`}
                </Toggle>
              )
            )}
          </ToggleGroup>
        ) : null}
        {ruleActionKind === "forward" ? (
          <div className="space-y-2">
            <Input
              aria-label="Forward recipients"
              onChange={(event) => {
                setRuleForwardRecipients(event.target.value);
              }}
              placeholder="Forward to email addresses"
              size="sm"
              value={ruleForwardRecipients}
            />
            <label
              className="flex items-center gap-2 text-body"
              htmlFor="rule-forward-includes-attachments"
            >
              <Checkbox
                checked={ruleForwardIncludesAttachments}
                id="rule-forward-includes-attachments"
                onCheckedChange={setRuleForwardIncludesAttachments}
              >
                <CheckboxIndicator />
              </Checkbox>
              Include attachments
            </label>
          </div>
        ) : null}
        <label
          className="flex items-center gap-2 text-body"
          htmlFor="rule-stop-processing"
        >
          <Checkbox
            checked={ruleStopsProcessing}
            id="rule-stop-processing"
            onCheckedChange={setRuleStopsProcessing}
          >
            <CheckboxIndicator />
          </Checkbox>
          Stop evaluating later rules after this match
        </label>
      </div>
    </div>
  );
};

const ManagedRuleLabelsEditor = (props: MailboxOrganizerContentProps) => {
  const {
    labelsData,
    ruleActionKind,
    selectedRuleLabelIdSet,
    setSelectedRuleLabelIds,
  } = props;

  return ruleActionKind === "set-labels" ? (
    <div>
      <div className="space-y-2">
        <Text size="sm" weight="medium">
          Apply these labels
        </Text>
        {labelsData !== undefined &&
          !labelsData.some((label) => label.type === "user") && (
            <Text size="sm" tone="muted">
              Create a label in Labels to use this action.
            </Text>
          )}
        {(labelsData ?? []).flatMap((label) =>
          label.type === "user"
            ? [
                <label
                  className="flex items-center gap-2 text-body"
                  htmlFor={`rule-label-${label.id}`}
                  key={label.id}
                >
                  <Checkbox
                    checked={selectedRuleLabelIdSet.has(label.id)}
                    id={`rule-label-${label.id}`}
                    onCheckedChange={(checked) => {
                      setSelectedRuleLabelIds((current) =>
                        checked
                          ? [...current, label.id]
                          : current.filter((labelId) => labelId !== label.id)
                      );
                    }}
                  >
                    <CheckboxIndicator />
                  </Checkbox>
                  <Icon aria-hidden size={14} tone="muted" icon={Tag01Icon} />
                  {label.name}
                </label>,
              ]
            : []
        )}
      </div>
    </div>
  ) : null;
};

const ManagedRulePreviewActions = (props: MailboxOrganizerContentProps) => {
  const {
    createRuleMutation,
    editingRuleId,
    editingRuleUpdatePending,
    preview,
    previewRule,
    previewRuleMutation,
    ruleActionKind,
    ruleForwardRecipients,
    ruleName,
    ruleQuery,
    saveRule,
    selectedRuleLabelIds,
  } = props;
  const validRuleInput = hasValidRuleInput({
    actionKind: ruleActionKind,
    forwardRecipients: ruleForwardRecipients,
    name: ruleName,
    query: ruleQuery,
    selectedLabelIds: selectedRuleLabelIds,
  });

  return (
    <>
      {preview ? (
        <p className="text-body text-muted-fg">
          {preview.count} matching conversation
          {preview.count === 1 ? "" : "s"}
        </p>
      ) : null}
      <ActionFooter>
        <Button
          disabled={!validRuleInput || previewRuleMutation.isPending}
          onClick={() => void previewRule()}
          pending={previewRuleMutation.isPending}
          pendingLabel="Previewing…"
          size="sm"
          type="button"
          variant="secondary"
        >
          Preview
        </Button>
        <Button
          disabled={
            !validRuleInput ||
            createRuleMutation.isPending ||
            editingRuleUpdatePending
          }
          onClick={() => void saveRule()}
          pending={createRuleMutation.isPending || editingRuleUpdatePending}
          pendingLabel={
            editingRuleId !== null && editingRuleId !== ""
              ? "Updating…"
              : "Saving…"
          }
          size="sm"
          type="button"
        >
          {editingRuleId !== null && editingRuleId !== ""
            ? "Update rule"
            : "Save rule"}
        </Button>
      </ActionFooter>
    </>
  );
};

const ManagedRuleBuilder = (props: MailboxOrganizerContentProps) => {
  const {
    editingRuleId,
    ruleMatchMode,
    ruleName,
    ruleQuery,
    setRuleMatchMode,
    setRuleName,
    setRuleQueryDraft,
  } = props;

  return (
    <SettingsSectionLayout
      title={editingRuleId ? "Edit rule" : "New rule"}
      description="Use the same filters as mail search to choose what this rule matches."
    >
      <SettingsCard>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <Field>
            <FieldLabel>Rule name</FieldLabel>
            <Input
              aria-label="Rule name"
              onChange={(event) => {
                setRuleName(event.target.value);
              }}
              placeholder="Rule name"
              size="sm"
              value={ruleName}
            />
          </Field>
          <Field>
            <FieldLabel>When mail matches</FieldLabel>
            <Input
              aria-label="Rule search"
              onChange={(event) => {
                setRuleQueryDraft(event.target.value);
              }}
              placeholder="from:vendor@example.com subject:invoice"
              size="sm"
              value={ruleQuery}
            />
            <FieldDescription>
              For example, from:vendor@example.com subject:invoice
            </FieldDescription>
          </Field>
          <ToggleGroup
            aria-label="Rule match"
            className="grid grid-cols-2"
            size="compact"
            variant="subtle"
            value={[ruleMatchMode]}
          >
            {(["all", "any"] as const).map((mode) => (
              <Toggle
                size="sm"
                key={mode}
                onClick={() => {
                  setRuleMatchMode(mode);
                }}
                type="button"
                value={mode}
              >
                Match {mode}
              </Toggle>
            ))}
          </ToggleGroup>
          <ManagedRuleActionEditor {...props} />
          <ManagedRuleLabelsEditor {...props} />
          <ManagedRulePreviewActions {...props} />
        </div>
      </SettingsCard>
    </SettingsSectionLayout>
  );
};

type ManagedRule = RouterOutputs["mail"]["listManagedRules"][number];

type ManagedRuleRowProps = MailboxOrganizerContentProps & {
  index: number;
  rule: ManagedRule;
  rules: ManagedRule[];
};

const ManagedRuleRow = (props: ManagedRuleRowProps) => {
  const {
    backfillMutation,
    deleteRuleMutation,
    isRowActionPending,
    mailboxId,
    pendingReorderRuleId,
    reorderRulesMutation,
    ruleConditionGroupsRef,
    ruleEnabledRef,
    ruleActionsRef,
    runOptimisticRuleUpdate,
    runRuleReorder,
    runRuleRowAction,
    setActiveBackfillId,
    setEditingRuleId,
    setPreview,
    setRuleActionKind,
    setRuleForwardIncludesAttachments,
    setRuleForwardRecipients,
    setRuleMatchMode,
    setRuleMoveDestination,
    setRuleName,
    setRuleQueryDraft,
    setRuleReadState,
    setRuleStopsProcessing,
    setSelectedRuleLabelIds,
    updateRuleMutation,
    index,
    rule,
    rules,
  } = props;

  return (
    <div
      className={settingsSurfaceVariants({ variant: "insetStackedRow" })}
      key={rule.id}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Icon aria-hidden tone="muted" icon={Tag01Icon} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body">{rule.name}</p>
          <p className="text-caption text-muted-fg">
            {rule.enabled ? "Enabled" : "Disabled"} /{" "}
            {getRuleActionLabel(
              getManagedMailboxRuleActions({
                actions: rule.actions,
                labelIds: rule.labelIds,
              })
            )}
          </p>
          {rule.disabledReason ? (
            <p className="text-caption text-muted-fg">{rule.disabledReason}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Switch
          aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
          checked={rule.enabled}
          disabled={rule.disabledReason !== null}
          className="shrink-0"
          size="sm"
          onCheckedChange={(enabled) => {
            const conditionGroups = getRuleConditionGroups(
              rule.conditionGroups
            );
            if (
              hasInvalidRuleConditionGroups(
                rule.conditionGroups,
                conditionGroups
              )
            ) {
              toast.error("This rule has invalid condition groups.");
              return;
            }
            void runOptimisticRuleUpdate(
              rule.id,
              enabled,
              async () =>
                await updateRuleMutation.mutateAsync({
                  definition: {
                    actions: getManagedMailboxRuleActions({
                      actions: rule.actions,
                      labelIds: rule.labelIds,
                    }),
                    conditionGroups,
                    enabled,
                    labelIds: rule.labelIds,
                    matchMode: rule.matchMode,
                    name: rule.name,
                    search: structuredMailSearchSchema.parse(rule.search),
                  },
                  mailboxId,
                  ruleId: rule.id,
                })
            );
          }}
        >
          <SwitchThumb />
        </Switch>
        <IconButtonTooltip label={`Edit ${rule.name}`}>
          <Button
            aria-label={`Edit ${rule.name}`}
            onClick={() => {
              const conditionGroups = getRuleConditionGroups(
                rule.conditionGroups
              );
              if (
                hasInvalidRuleConditionGroups(
                  rule.conditionGroups,
                  conditionGroups
                )
              ) {
                toast.error("This rule has invalid condition groups.");
                return;
              }
              setEditingRuleId(rule.id);
              setRuleName(rule.name);
              setRuleQueryDraft(
                serializeStructuredSearchState(
                  structuredMailSearchSchema.parse(rule.search)
                )
              );
              setRuleMatchMode(rule.matchMode);
              ruleConditionGroupsRef.current = conditionGroups ?? null;
              const actions = getManagedMailboxRuleActions({
                actions: rule.actions,
                labelIds: rule.labelIds,
              });
              const action = getPrimaryRuleAction(actions);
              ruleActionsRef.current = actions;
              ruleEnabledRef.current = rule.enabled;
              setSelectedRuleLabelIds(
                action?.kind === "set-labels" ? action.addIds : []
              );
              setRuleForwardIncludesAttachments(false);
              if (action?.kind === "set-read") {
                setRuleActionKind("set-read");
                setRuleReadState(action.read);
              } else if (action?.kind === "move") {
                setRuleActionKind("move");
                setRuleMoveDestination(action.destination);
              } else if (action?.kind === "forward") {
                setRuleActionKind("forward");
                setRuleForwardRecipients(action.recipients.join(", "));
                setRuleForwardIncludesAttachments(action.includeAttachments);
              } else {
                setRuleActionKind("set-labels");
              }
              setRuleStopsProcessing(
                actions.some(
                  (candidate) => candidate.kind === "stop-processing"
                )
              );
              setPreview(null);
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden icon={Edit01Icon} />
          </Button>
        </IconButtonTooltip>
        <IconButtonTooltip label={`Move ${rule.name} up`}>
          <Button
            aria-label={`Move ${rule.name} up`}
            disabled={index === 0 || pendingReorderRuleId !== null}
            pending={pendingReorderRuleId === rule.id}
            onClick={() => {
              const ruleIds = rules.map((candidate) => candidate.id);
              [ruleIds[index - 1], ruleIds[index]] = [
                ruleIds[index],
                ruleIds[index - 1],
              ];
              void runRuleReorder(
                rule.id,
                async () =>
                  await reorderRulesMutation.mutateAsync({
                    mailboxId,
                    ruleIds,
                  }),
                "Could not reorder rules."
              );
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden icon={ArrowUp01Icon} />
          </Button>
        </IconButtonTooltip>
        <IconButtonTooltip label={`Move ${rule.name} down`}>
          <Button
            aria-label={`Move ${rule.name} down`}
            disabled={
              index === rules.length - 1 || pendingReorderRuleId !== null
            }
            pending={pendingReorderRuleId === rule.id}
            onClick={() => {
              const ruleIds = rules.map((candidate) => candidate.id);
              [ruleIds[index], ruleIds[index + 1]] = [
                ruleIds[index + 1],
                ruleIds[index],
              ];
              void runRuleReorder(
                rule.id,
                async () =>
                  await reorderRulesMutation.mutateAsync({
                    mailboxId,
                    ruleIds,
                  }),
                "Could not reorder rules."
              );
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden icon={ArrowDown01Icon} />
          </Button>
        </IconButtonTooltip>
        <IconButtonTooltip label={`Apply ${rule.name} to existing mail`}>
          <Button
            aria-label={`Apply ${rule.name} to existing mail`}
            disabled={isRowActionPending(rule.id, "backfill")}
            pending={isRowActionPending(rule.id, "backfill")}
            pendingLabel="Running…"
            onClick={() => {
              void runRuleRowAction(
                rule.id,
                "backfill",
                async () =>
                  await backfillMutation.mutateAsync({
                    mailboxId,
                    ruleId: rule.id,
                  }),
                "Could not start the historical rule run.",
                (backfill) => {
                  setActiveBackfillId(backfill.id);
                  toast.success("Historical rule run started.");
                }
              );
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden icon={ArrowRight01Icon} />
          </Button>
        </IconButtonTooltip>
        <IconButtonTooltip label={`Delete ${rule.name}`}>
          <Button
            aria-label={`Delete ${rule.name}`}
            disabled={isRowActionPending(rule.id, "delete")}
            pending={isRowActionPending(rule.id, "delete")}
            onClick={() => {
              void runRuleRowAction(
                rule.id,
                "delete",
                async () =>
                  await deleteRuleMutation.mutateAsync({
                    mailboxId,
                    ruleId: rule.id,
                  }),
                "Could not delete rule."
              );
            }}
            size="icon-sm"
            type="button"
            variant="destructive"
          >
            <Icon aria-hidden icon={Delete01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>
    </div>
  );
};

const ManagedRulesList = (props: MailboxOrganizerContentProps) => {
  const { invalidateRules, rulesData, rulesError, rulesPending } = props;

  if (rulesPending) {
    return (
      <Text size="sm" tone="muted">
        Loading rules…
      </Text>
    );
  }

  if (rulesError && rulesData === undefined) {
    return (
      <div className="space-y-3">
        <Text size="sm" tone="muted">
          Could not load rules.
        </Text>
        <Button
          onClick={() => void invalidateRules()}
          size="sm"
          type="button"
          variant="secondary"
        >
          Try again
        </Button>
      </div>
    );
  }

  if (rulesData?.length === 0) {
    return (
      <Text size="sm" tone="muted">
        No rules yet.
      </Text>
    );
  }

  return (
    <SettingsCard>
      {(rulesData ?? []).map((rule, index, rules) => (
        <ManagedRuleRow
          {...props}
          index={index}
          key={rule.id}
          rule={rule}
          rules={rules}
        />
      ))}
    </SettingsCard>
  );
};

const ManagedRuleBackfill = (props: MailboxOrganizerContentProps) => {
  const { backfillData, cancelBackfill, cancelBackfillMutation } = props;

  return backfillData ? (
    <Surface className="mt-4">
      <div className="flex items-center justify-between gap-3 text-body">
        <div>
          <p className="font-medium">Historical rule run</p>
          {backfillData.status === "failed" && (
            <p className="text-caption text-muted-fg">
              Processing stopped before the failed message. Run this rule again
              to retry.
            </p>
          )}
          <p className="text-caption text-muted-fg">
            {backfillData.processedCount} processed {backfillData.matchedCount}{" "}
            matched
          </p>
        </div>
        {["pending", "running"].includes(backfillData.status) ? (
          <Button
            disabled={cancelBackfillMutation.isPending}
            pending={cancelBackfillMutation.isPending}
            pendingLabel="Cancelling…"
            onClick={() => {
              void cancelBackfill(backfillData.id);
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
        ) : (
          <span className="text-caption text-muted-fg capitalize">
            {backfillData.status}
          </span>
        )}
      </div>
    </Surface>
  ) : null;
};

export const ManagedMailboxRulesPanel = (
  props: MailboxOrganizerContentProps
) => {
  const { canManage } = props;

  return (
    <div className="space-y-6">
      {canManage ? (
        <>
          <SettingsSectionLayout
            title="Automatic rules"
            description="Rules run from top to bottom. Turn a rule off to pause it."
          >
            <ManagedRulesList {...props} />
          </SettingsSectionLayout>
          <ManagedRuleBackfill {...props} />
          <ManagedRuleBuilder {...props} />
        </>
      ) : (
        <p className="text-body text-muted-fg">
          Mailbox managers configure automatic rules.
        </p>
      )}
    </div>
  );
};
