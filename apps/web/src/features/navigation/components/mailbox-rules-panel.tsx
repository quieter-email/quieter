"use client";

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Delete01Icon,
  Edit01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { FullPageDialogDescription } from "@quieter/ui/full-page-dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";

import type {
  RuleActionKind,
  MailboxOrganizerContentProps,
} from "./mailbox-organizer-types";

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
    <div className="squircle space-y-2 rounded-lg bg-secondary/40 p-3">
      <p className="text-caption font-medium text-muted-fg">Then</p>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {(
          [
            ["set-labels", "Apply labels"],
            ["set-read", "Read state"],
            ["move", "Move"],
            ["forward", "Forward"],
          ] as const
        ).map(([kind, label]) => (
          <Button
            aria-pressed={ruleActionKind === kind}
            className={cn({
              "bg-bg-surface shadow-sm": ruleActionKind === kind,
            })}
            key={kind}
            onClick={() => {
              setRuleActionKind(kind);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {label}
          </Button>
        ))}
      </div>
      {ruleActionKind === "set-read" ? (
        <div className="grid grid-cols-2 gap-1">
          {[true, false].map((read) => (
            <Button
              aria-pressed={ruleReadState === read}
              className={cn({
                "bg-bg-surface shadow-sm": ruleReadState === read,
              })}
              key={String(read)}
              onClick={() => {
                setRuleReadState(read);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {read ? "Mark read" : "Mark unread"}
            </Button>
          ))}
        </div>
      ) : null}
      {ruleActionKind === "move" ? (
        <div className="grid grid-cols-2 gap-1">
          {(["archive", "inbox", "spam", "trash"] as const).map(
            (destination) => (
              <Button
                aria-pressed={ruleMoveDestination === destination}
                className={cn({
                  "bg-bg-surface shadow-sm":
                    ruleMoveDestination === destination,
                })}
                key={destination}
                onClick={() => {
                  setRuleMoveDestination(destination);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {destination === "inbox"
                  ? "Move to Inbox"
                  : `Move to ${destination[0]?.toUpperCase()}${destination.slice(1)}`}
              </Button>
            )
          )}
        </div>
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
    <div className="squircle space-y-2 rounded-lg bg-secondary/40 p-3">
      <p className="text-caption font-medium text-muted-fg">Labels</p>
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
                <HugeiconsIcon
                  aria-hidden
                  className="size-3.5 text-muted-fg"
                  icon={Tag01Icon}
                />
                {label.name}
              </label>,
            ]
          : []
      )}
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
      <div className="flex gap-2">
        <Button
          disabled={!validRuleInput || previewRuleMutation.isPending}
          onClick={() => void previewRule()}
          pending={previewRuleMutation.isPending}
          pendingLabel="Previewing…"
          size="sm"
          type="button"
          variant="outline"
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
      </div>
    </>
  );
};

const ManagedRuleBuilder = (props: MailboxOrganizerContentProps) => {
  const {
    ruleMatchMode,
    ruleName,
    ruleQuery,
    setRuleMatchMode,
    setRuleName,
    setRuleQueryDraft,
  } = props;

  return (
    <div className="mt-5 space-y-3">
      <Input
        aria-label="Rule name"
        onChange={(event) => {
          setRuleName(event.target.value);
        }}
        placeholder="Rule name"
        size="sm"
        value={ruleName}
      />
      <Input
        aria-label="Rule search"
        onChange={(event) => {
          setRuleQueryDraft(event.target.value);
        }}
        placeholder="from:vendor@example.com subject:invoice"
        size="sm"
        value={ruleQuery}
      />
      <div className="grid grid-cols-2 rounded-lg bg-muted/40 p-0.5">
        {(["all", "any"] as const).map((mode) => (
          <Button
            aria-pressed={ruleMatchMode === mode}
            className={cn({
              "bg-bg-surface shadow-sm": ruleMatchMode === mode,
            })}
            key={mode}
            onClick={() => {
              setRuleMatchMode(mode);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Match {mode}
          </Button>
        ))}
      </div>
      <ManagedRuleActionEditor {...props} />
      <ManagedRuleLabelsEditor {...props} />
      <ManagedRulePreviewActions {...props} />
    </div>
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
    pendingReorders,
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
    <div className="flex items-center gap-3 py-2" key={rule.id}>
      <HugeiconsIcon
        aria-hidden
        className="size-4 text-muted-fg"
        icon={Tag01Icon}
      />
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
      <Switch
        aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
        checked={rule.enabled}
        disabled={rule.disabledReason !== null}
        className="shrink-0"
        size="sm"
        onCheckedChange={(enabled) => {
          const conditionGroups = getRuleConditionGroups(rule.conditionGroups);
          if (
            hasInvalidRuleConditionGroups(rule.conditionGroups, conditionGroups)
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
              actions.some((candidate) => candidate.kind === "stop-processing")
            );
            setPreview(null);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={Edit01Icon} />
        </Button>
      </IconButtonTooltip>
      <IconButtonTooltip label={`Move ${rule.name} up`}>
        <Button
          aria-label={`Move ${rule.name} up`}
          disabled={index === 0 || pendingReorders.rules !== undefined}
          pending={pendingReorders.rules === rule.id}
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
          <HugeiconsIcon aria-hidden icon={ArrowUp01Icon} />
        </Button>
      </IconButtonTooltip>
      <IconButtonTooltip label={`Move ${rule.name} down`}>
        <Button
          aria-label={`Move ${rule.name} down`}
          disabled={
            index === rules.length - 1 || pendingReorders.rules !== undefined
          }
          pending={pendingReorders.rules === rule.id}
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
          <HugeiconsIcon aria-hidden icon={ArrowDown01Icon} />
        </Button>
      </IconButtonTooltip>
      <IconButtonTooltip label={`Apply ${rule.name} to existing mail`}>
        <Button
          aria-label={`Apply ${rule.name} to existing mail`}
          disabled={isRowActionPending("rule", rule.id, "backfill")}
          pending={isRowActionPending("rule", rule.id, "backfill")}
          pendingLabel="Running…"
          onClick={() => {
            void runRuleRowAction(
              "rule",
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
          <HugeiconsIcon aria-hidden icon={ArrowRight01Icon} />
        </Button>
      </IconButtonTooltip>
      <IconButtonTooltip label={`Delete ${rule.name}`}>
        <Button
          aria-label={`Delete ${rule.name}`}
          disabled={isRowActionPending("rule", rule.id, "delete")}
          pending={isRowActionPending("rule", rule.id, "delete")}
          onClick={() => {
            void runRuleRowAction(
              "rule",
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
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={Delete01Icon} />
        </Button>
      </IconButtonTooltip>
    </div>
  );
};

const ManagedRulesList = (props: MailboxOrganizerContentProps) => {
  const { rulesData } = props;

  return (
    <div className="mt-5 divide-y">
      {(rulesData ?? []).map((rule, index, rules) => (
        <ManagedRuleRow
          {...props}
          index={index}
          key={rule.id}
          rule={rule}
          rules={rules}
        />
      ))}
    </div>
  );
};

const ManagedRuleBackfill = (props: MailboxOrganizerContentProps) => {
  const { backfillData, cancelBackfill, cancelBackfillMutation } = props;

  return backfillData ? (
    <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-body">
      <div className="flex items-center justify-between gap-3">
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
            variant="outline"
          >
            Cancel
          </Button>
        ) : (
          <span className="text-caption text-muted-fg capitalize">
            {backfillData.status}
          </span>
        )}
      </div>
    </div>
  ) : null;
};

export const ManagedMailboxRulesPanel = (
  props: MailboxOrganizerContentProps
) => {
  const { canManage } = props;

  return (
    <section>
      <h2 className="text-body-lg font-semibold tracking-tight">
        Automatic rules
      </h2>
      <FullPageDialogDescription className="mt-1">
        Match new inbound mail with the same filters used by search, then apply
        a predictable action.
      </FullPageDialogDescription>
      {canManage ? (
        <>
          <ManagedRuleBuilder {...props} />
          <ManagedRulesList {...props} />
          <ManagedRuleBackfill {...props} />
        </>
      ) : (
        <p className="mt-5 text-body text-muted-fg">
          Mailbox managers configure automatic rules.
        </p>
      )}
    </section>
  );
};
