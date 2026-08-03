"use client";

import type { RouterOutputs } from "@quieter/orpc";
import {
  ArrowLeft02Icon,
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
  mailboxLabelColorSchema,
  managedMailboxRuleConditionGroupSchema,
  type ManagedMailboxRuleAction,
  type ManagedMailboxRuleConditionGroup,
  type MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import {
  areStructuredMailSearchesEqual,
  parseStructuredSearchQuery,
  serializeStructuredSearchState,
  structuredMailSearchSchema,
} from "@quieter/mail/search";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import {
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogDescription,
  FullPageDialogHeader,
  FullPageDialogTitle,
} from "@quieter/ui/full-page-dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { MailboxColorPicker } from "~/features/message-labels/components/mailbox-color-picker";
import { mailboxLabelDotClassNameByColor } from "~/features/message-labels/domain/mailbox-label-presentation";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";
import {
  getManagedRulesQueryKey,
  getManagedSavedViewsQueryKey,
  managedRulesQueryOptions,
  managedSavedViewsQueryOptions,
} from "~/lib/managed-mailbox-organization-query";
import { orpc, rpc } from "~/lib/orpc";
import { SidebarNavItem } from "./sidebar-nav-item";

type ManagedMailboxOrganizerProps = {
  canManage: boolean;
  mailboxId: string;
  onSearch: (query: string) => void;
  searchQuery: string;
};

type ManagedSavedView = RouterOutputs["mail"]["listManagedSavedViews"][number];
type EditingView = {
  color: MailboxLabelColor;
  name: string;
  view: ManagedSavedView;
};
type SavedViewsSectionProps = {
  currentSearch: ReturnType<typeof parseStructuredSearchQuery>;
  emptyMessage: string;
  onSearch: (query: string) => void;
  title: string;
  views: ManagedSavedView[];
};

const getSearchFromStoredValue = (value: unknown) => structuredMailSearchSchema.parse(value);
const getSavedViewColor = (color: string | null) =>
  color ? mailboxLabelColorSchema.parse(color) : "gray";
const getPrimaryRuleAction = (actions: readonly ManagedMailboxRuleAction[]) =>
  actions.find((action) => action.kind !== "stop-processing") ?? actions[0];
const getRuleActionLabel = (actions: readonly ManagedMailboxRuleAction[]) => {
  const action = getPrimaryRuleAction(actions);
  if (!action) return "No action";
  if (action.kind === "set-labels") return "Apply labels";
  if (action.kind === "set-read") return action.read ? "Mark read" : "Mark unread";
  if (action.kind === "move") {
    return action.destination === "inbox"
      ? "Move to Inbox"
      : `Move to ${action.destination[0]?.toUpperCase()}${action.destination.slice(1)}`;
  }
  if (action.kind === "forward") return `Forward to ${action.recipients.join(", ")}`;
  return "Stop processing";
};
const getRuleConditionGroups = (conditionGroups: unknown) => {
  const parsed = managedMailboxRuleConditionGroupSchema.array().safeParse(conditionGroups);
  return parsed.success ? parsed.data : undefined;
};

type PendingRowKind = "rule" | "view";
type PendingRowAction = "backfill" | "delete" | "duplicate" | "reorder" | "update";

const getPendingRowActionKey = (kind: PendingRowKind, id: string, action: PendingRowAction) =>
  `${kind}:${id}:${action}`;

const SavedViewsSection = ({
  currentSearch,
  emptyMessage,
  onSearch,
  title,
  views,
}: SavedViewsSectionProps) => (
  <section className="mt-4">
    <p className="mb-1 px-2 text-xs font-medium text-muted-fg">{title}</p>
    {views.length === 0 ? (
      <p className="px-2 py-1 text-xs text-muted-fg">{emptyMessage}</p>
    ) : (
      <nav aria-label={title} className="flex flex-col">
        {views.map((view) => {
          const search = getSearchFromStoredValue(view.search);
          const active = areStructuredMailSearchesEqual(currentSearch, search);
          return (
            <SidebarNavItem
              active={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "squircle h-7 w-full min-w-0 justify-start gap-2 rounded-md px-2.5 text-left text-xs font-light",
                {
                  "text-fg": active,
                  "text-muted-fg": !active,
                },
              )}
              key={view.id}
              onClick={() => onSearch(serializeStructuredSearchState(search))}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  mailboxLabelDotClassNameByColor[getSavedViewColor(view.color)],
                )}
              />
              <span className="truncate">{view.name}</span>
            </SidebarNavItem>
          );
        })}
      </nav>
    )}
  </section>
);

export const ManagedMailboxOrganizer = ({
  canManage,
  mailboxId,
  onSearch,
  searchQuery,
}: ManagedMailboxOrganizerProps) => {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [newViewColor, setNewViewColor] = useState<MailboxLabelColor>("gray");
  const [viewName, setViewName] = useState("");
  const [editingView, setEditingView] = useState<EditingView | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleQueryDraft, setRuleQueryDraft] = useState<string | null>(null);
  const ruleQuery = ruleQueryDraft ?? searchQuery;
  const [ruleMatchMode, setRuleMatchMode] = useState<"all" | "any">("all");
  const ruleConditionGroupsRef = useRef<ManagedMailboxRuleConditionGroup[] | undefined>(undefined);
  const [ruleActionKind, setRuleActionKind] = useState<
    "forward" | "move" | "set-labels" | "set-read"
  >("set-labels");
  const [ruleReadState, setRuleReadState] = useState(true);
  const [ruleMoveDestination, setRuleMoveDestination] = useState<
    "archive" | "inbox" | "spam" | "trash"
  >("archive");
  const [ruleForwardRecipients, setRuleForwardRecipients] = useState("");
  const [ruleStopsProcessing, setRuleStopsProcessing] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [selectedRuleLabelIds, setSelectedRuleLabelIds] = useState<string[]>([]);
  const selectedRuleLabelIdSet = new Set(selectedRuleLabelIds);
  const [activeBackfillId, setActiveBackfillId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; samples: Array<{ id: string }> } | null>(
    null,
  );
  const [pendingRowActions, setPendingRowActions] = useState<Record<string, true>>({});
  const { data: viewsData } = useQuery(managedSavedViewsQueryOptions(mailboxId));
  const { data: rulesData } = useQuery(managedRulesQueryOptions(mailboxId, isOpen && canManage));
  const { data: labelsData } = useQuery(labelsQueryOptions(mailboxId, isOpen));
  const { data: backfillData } = useQuery({
    enabled: !!activeBackfillId,
    queryFn: ({ signal }) =>
      rpc.mail.getManagedRuleBackfill({ backfillId: activeBackfillId!, mailboxId }, { signal }),
    queryKey: ["managed-rule-backfill", mailboxId, activeBackfillId],
    refetchInterval: (query) =>
      ["pending", "running"].includes(query.state.data?.status ?? "") ? 1000 : false,
  });
  const currentSearch = parseStructuredSearchQuery(searchQuery);
  const views = viewsData ?? [];
  const sharedViews = views.filter((view) => view.ownerUserId === null);
  const personalViews = views.filter((view) => view.ownerUserId !== null);

  const invalidateViews = () =>
    queryClient.invalidateQueries({ queryKey: getManagedSavedViewsQueryKey(mailboxId) });
  const invalidateRules = () =>
    queryClient.invalidateQueries({ queryKey: getManagedRulesQueryKey(mailboxId) });
  const createViewMutation = useMutation(orpc.mail.createManagedSavedView.mutationOptions());
  const deleteViewMutation = useMutation(orpc.mail.deleteManagedSavedView.mutationOptions());
  const updateViewMutation = useMutation(orpc.mail.updateManagedSavedView.mutationOptions());
  const reorderViewsMutation = useMutation(orpc.mail.reorderManagedSavedViews.mutationOptions());
  const createRuleMutation = useMutation(orpc.mail.createManagedRule.mutationOptions());
  const deleteRuleMutation = useMutation(orpc.mail.deleteManagedRule.mutationOptions());
  const reorderRulesMutation = useMutation(orpc.mail.reorderManagedRules.mutationOptions());
  const updateRuleMutation = useMutation(orpc.mail.updateManagedRule.mutationOptions());
  const previewRuleMutation = useMutation(orpc.mail.previewManagedRule.mutationOptions());
  const backfillMutation = useMutation(orpc.mail.startManagedRuleBackfill.mutationOptions());
  const cancelBackfillMutation = useMutation(orpc.mail.cancelManagedRuleBackfill.mutationOptions());

  const isRowActionPending = (kind: PendingRowKind, id: string, action: PendingRowAction) =>
    pendingRowActions[getPendingRowActionKey(kind, id, action)] === true;

  const runRowAction = async <T,>(
    kind: PendingRowKind,
    id: string,
    action: PendingRowAction,
    operation: () => Promise<T>,
  ) => {
    const key = getPendingRowActionKey(kind, id, action);
    setPendingRowActions((current) => ({ ...current, [key]: true }));
    try {
      return await operation();
    } finally {
      setPendingRowActions((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const editingRuleUpdatePending =
    editingRuleId !== null && isRowActionPending("rule", editingRuleId, "update");
  const editingViewUpdatePending =
    editingView !== null && isRowActionPending("view", editingView.view.id, "update");

  const saveView = async (shared: boolean) => {
    const name = viewName.trim();
    if (!name) return;
    try {
      await createViewMutation.mutateAsync({
        definition: {
          color: newViewColor,
          icon: null,
          name,
          search: currentSearch,
          sort: "newest",
        },
        mailboxId,
        shared,
      });
      setNewViewColor("gray");
      setViewName("");
      await invalidateViews();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save view.");
    }
  };

  const saveViewEdit = async () => {
    if (!editingView?.name.trim()) return;

    try {
      await runRowAction("view", editingView.view.id, "update", () =>
        updateViewMutation.mutateAsync({
          definition: {
            color: editingView.color,
            icon: editingView.view.icon,
            name: editingView.name.trim(),
            search: getSearchFromStoredValue(editingView.view.search),
            sort: editingView.view.sort,
          },
          mailboxId,
          viewId: editingView.view.id,
        }),
      );
      setEditingView(null);
      await invalidateViews();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update view.");
    }
  };

  const createRuleDefinition = () => {
    const action: ManagedMailboxRuleAction =
      ruleActionKind === "set-labels"
        ? { addIds: selectedRuleLabelIds, kind: "set-labels", removeIds: [] }
        : ruleActionKind === "set-read"
          ? { kind: "set-read", read: ruleReadState }
          : ruleActionKind === "move"
            ? { destination: ruleMoveDestination, kind: "move" }
            : {
                includeAttachments: false,
                kind: "forward",
                recipients: ruleForwardRecipients
                  .split(/[,;\n]/)
                  .map((recipient) => recipient.trim())
                  .filter(Boolean),
              };

    return {
      actions: [action, ...(ruleStopsProcessing ? [{ kind: "stop-processing" as const }] : [])],
      conditionGroups: ruleConditionGroupsRef.current,
      enabled: true,
      labelIds: ruleActionKind === "set-labels" ? selectedRuleLabelIds : [],
      matchMode: ruleMatchMode,
      name: ruleName.trim(),
      search: parseStructuredSearchQuery(ruleQuery),
    };
  };

  const previewRule = async () => {
    try {
      const result = await previewRuleMutation.mutateAsync({
        definition: createRuleDefinition(),
        mailboxId,
      });
      setPreview(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not preview rule.");
    }
  };

  const saveRule = async () => {
    if (
      !ruleName.trim() ||
      (ruleActionKind === "set-labels" && selectedRuleLabelIds.length === 0) ||
      (ruleActionKind === "forward" && !ruleForwardRecipients.trim())
    )
      return;
    try {
      if (editingRuleId) {
        await runRowAction("rule", editingRuleId, "update", () =>
          updateRuleMutation.mutateAsync({
            definition: createRuleDefinition(),
            mailboxId,
            ruleId: editingRuleId,
          }),
        );
      } else {
        await createRuleMutation.mutateAsync({
          definition: createRuleDefinition(),
          mailboxId,
        });
      }
      setRuleName("");
      setRuleQueryDraft("");
      setRuleMatchMode("all");
      ruleConditionGroupsRef.current = undefined;
      setRuleActionKind("set-labels");
      setRuleReadState(true);
      setRuleMoveDestination("archive");
      setRuleForwardRecipients("");
      setRuleStopsProcessing(false);
      setSelectedRuleLabelIds([]);
      setEditingRuleId(null);
      setPreview(null);
      await invalidateRules();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save rule.");
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <SavedViewsSection
            currentSearch={currentSearch}
            emptyMessage="No shared views."
            onSearch={onSearch}
            title="Views"
            views={sharedViews}
          />
          <SavedViewsSection
            currentSearch={currentSearch}
            emptyMessage="No personal views."
            onSearch={onSearch}
            title="My views"
            views={personalViews}
          />
        </div>
        <IconButtonTooltip label="Manage views and rules">
          <Button
            aria-label="Manage views and rules"
            className="mt-4 size-6 self-start text-muted-fg hover:text-fg"
            onClick={() => {
              setRuleQueryDraft(searchQuery);
              setIsOpen(true);
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden className="size-3.5" icon={Edit01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>

      <FullPageDialog onOpenChange={setIsOpen} open={isOpen}>
        <FullPageDialogContent>
          <FullPageDialogHeader>
            <IconButtonTooltip label="Close organizer">
              <FullPageDialogClose aria-label="Close organizer">
                <HugeiconsIcon aria-hidden icon={ArrowLeft02Icon} />
              </FullPageDialogClose>
            </IconButtonTooltip>
            <FullPageDialogTitle>Organize mailbox</FullPageDialogTitle>
          </FullPageDialogHeader>
          <FullPageDialogBody>
            <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-8 md:grid-cols-2">
              <section>
                <h2 className="text-lg font-semibold tracking-tight">Saved views</h2>
                <FullPageDialogDescription className="mt-1">
                  Save the current search for quick access from the sidebar.
                </FullPageDialogDescription>
                <div className="squircle mt-5 rounded-xl bg-secondary/40 p-3">
                  <div className="flex gap-2">
                    <Input
                      aria-label="Saved view name"
                      className="border-0 bg-bg/70 shadow-none"
                      onChange={(event) => setViewName(event.target.value)}
                      placeholder="View name"
                      size="sm"
                      value={viewName}
                    />
                    <Button
                      disabled={!viewName.trim() || createViewMutation.isPending}
                      onClick={() => void saveView(false)}
                      pending={createViewMutation.isPending}
                      pendingLabel="Saving…"
                      size="sm"
                      type="button"
                    >
                      Save mine
                    </Button>
                    {canManage ? (
                      <Button
                        disabled={!viewName.trim() || createViewMutation.isPending}
                        onClick={() => void saveView(true)}
                        pending={createViewMutation.isPending}
                        pendingLabel="Saving…"
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Save shared
                      </Button>
                    ) : null}
                  </div>
                  <MailboxColorPicker
                    className="mt-3"
                    label="Saved view color"
                    onChange={setNewViewColor}
                    value={newViewColor}
                  />
                </div>
                <div className="mt-5 space-y-1">
                  {views.map((view, index) => (
                    <div
                      className="squircle flex items-center gap-3 rounded-lg p-2 hover:bg-secondary/25"
                      key={view.id}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-3 shrink-0 rounded-full",
                          mailboxLabelDotClassNameByColor[getSavedViewColor(view.color)],
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{view.name}</span>
                      <span className="text-xs text-muted-fg">
                        {view.ownerUserId === null ? "Shared" : "Personal"}
                      </span>
                      {(view.ownerUserId !== null || canManage) && (
                        <IconButtonTooltip label={`Edit ${view.name}`}>
                          <Button
                            aria-label={`Edit ${view.name}`}
                            onClick={() =>
                              setEditingView({
                                color: getSavedViewColor(view.color),
                                name: view.name,
                                view,
                              })
                            }
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <HugeiconsIcon aria-hidden icon={Edit01Icon} />
                          </Button>
                        </IconButtonTooltip>
                      )}
                      {view.ownerUserId !== null || canManage ? (
                        <Button
                          disabled={
                            isRowActionPending("view", view.id, "update") ||
                            areStructuredMailSearchesEqual(
                              currentSearch,
                              getSearchFromStoredValue(view.search),
                            )
                          }
                          onClick={() => {
                            void runRowAction("view", view.id, "update", () =>
                              updateViewMutation.mutateAsync({
                                definition: {
                                  color: getSavedViewColor(view.color),
                                  icon: view.icon,
                                  name: view.name,
                                  search: currentSearch,
                                  sort: view.sort,
                                },
                                mailboxId,
                                viewId: view.id,
                              }),
                            )
                              .then(invalidateViews)
                              .catch((error) =>
                                toast.error(
                                  error instanceof Error ? error.message : "Could not update view.",
                                ),
                              );
                          }}
                          pending={isRowActionPending("view", view.id, "update")}
                          pendingLabel="Updating…"
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Use current search
                        </Button>
                      ) : null}
                      {view.ownerUserId === null ? (
                        <Button
                          disabled={isRowActionPending("view", view.id, "duplicate")}
                          onClick={() => {
                            void runRowAction("view", view.id, "duplicate", () =>
                              createViewMutation.mutateAsync({
                                definition: {
                                  color: getSavedViewColor(view.color),
                                  icon: view.icon,
                                  name: `${view.name} copy`,
                                  search: getSearchFromStoredValue(view.search),
                                  sort: view.sort,
                                },
                                mailboxId,
                                shared: false,
                              }),
                            )
                              .then(invalidateViews)
                              .catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not duplicate view.",
                                ),
                              );
                          }}
                          pending={isRowActionPending("view", view.id, "duplicate")}
                          pendingLabel="Copying…"
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Duplicate
                        </Button>
                      ) : null}
                      <IconButtonTooltip label={`Move ${view.name} up`}>
                        <Button
                          aria-label={`Move ${view.name} up`}
                          disabled={index === 0 || isRowActionPending("view", view.id, "reorder")}
                          onClick={() => {
                            const sameScopeViews = views.filter(
                              (candidate) =>
                                (candidate.ownerUserId === null) === (view.ownerUserId === null),
                            );
                            const scopeIndex = sameScopeViews.findIndex(
                              (candidate) => candidate.id === view.id,
                            );
                            if (scopeIndex <= 0) return;
                            const viewIds = sameScopeViews.map((candidate) => candidate.id);
                            [viewIds[scopeIndex - 1], viewIds[scopeIndex]] = [
                              viewIds[scopeIndex],
                              viewIds[scopeIndex - 1],
                            ];
                            void runRowAction("view", view.id, "reorder", () =>
                              reorderViewsMutation.mutateAsync({ mailboxId, viewIds }),
                            )
                              .then(invalidateViews)
                              .catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not reorder views.",
                                ),
                              );
                          }}
                          pending={isRowActionPending("view", view.id, "reorder")}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <HugeiconsIcon aria-hidden icon={ArrowUp01Icon} />
                        </Button>
                      </IconButtonTooltip>
                      <IconButtonTooltip label={`Move ${view.name} down`}>
                        <Button
                          aria-label={`Move ${view.name} down`}
                          disabled={
                            index === views.length - 1 ||
                            isRowActionPending("view", view.id, "reorder")
                          }
                          onClick={() => {
                            const sameScopeViews = views.filter(
                              (candidate) =>
                                (candidate.ownerUserId === null) === (view.ownerUserId === null),
                            );
                            const scopeIndex = sameScopeViews.findIndex(
                              (candidate) => candidate.id === view.id,
                            );
                            if (scopeIndex === -1 || scopeIndex === sameScopeViews.length - 1)
                              return;
                            const viewIds = sameScopeViews.map((candidate) => candidate.id);
                            [viewIds[scopeIndex], viewIds[scopeIndex + 1]] = [
                              viewIds[scopeIndex + 1],
                              viewIds[scopeIndex],
                            ];
                            void runRowAction("view", view.id, "reorder", () =>
                              reorderViewsMutation.mutateAsync({ mailboxId, viewIds }),
                            )
                              .then(invalidateViews)
                              .catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not reorder views.",
                                ),
                              );
                          }}
                          pending={isRowActionPending("view", view.id, "reorder")}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <HugeiconsIcon aria-hidden icon={ArrowDown01Icon} />
                        </Button>
                      </IconButtonTooltip>
                      {(view.ownerUserId !== null || canManage) && (
                        <IconButtonTooltip label={`Delete ${view.name}`}>
                          <Button
                            aria-label={`Delete ${view.name}`}
                            disabled={isRowActionPending("view", view.id, "delete")}
                            pending={isRowActionPending("view", view.id, "delete")}
                            onClick={() => {
                              void runRowAction("view", view.id, "delete", () =>
                                deleteViewMutation.mutateAsync({ mailboxId, viewId: view.id }),
                              )
                                .then(invalidateViews)
                                .catch((error) =>
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Could not delete view.",
                                  ),
                                );
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <HugeiconsIcon aria-hidden icon={Delete01Icon} />
                          </Button>
                        </IconButtonTooltip>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="text-lg font-semibold tracking-tight">Automatic rules</h2>
                <FullPageDialogDescription className="mt-1">
                  Match new inbound mail with the same filters used by search, then apply a
                  predictable action.
                </FullPageDialogDescription>
                {canManage ? (
                  <>
                    <div className="mt-5 space-y-3">
                      <Input
                        aria-label="Rule name"
                        onChange={(event) => setRuleName(event.target.value)}
                        placeholder="Rule name"
                        size="sm"
                        value={ruleName}
                      />
                      <Input
                        aria-label="Rule search"
                        onChange={(event) => setRuleQueryDraft(event.target.value)}
                        placeholder="from:vendor@example.com subject:invoice"
                        size="sm"
                        value={ruleQuery}
                      />
                      <div className="grid grid-cols-2 rounded-lg bg-muted/40 p-0.5">
                        {(["all", "any"] as const).map((mode) => (
                          <Button
                            aria-pressed={ruleMatchMode === mode}
                            className={cn({
                              "bg-bg shadow-sm": ruleMatchMode === mode,
                            })}
                            key={mode}
                            onClick={() => setRuleMatchMode(mode)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Match {mode}
                          </Button>
                        ))}
                      </div>
                      <div className="squircle space-y-2 rounded-lg bg-secondary/40 p-3">
                        <p className="text-xs font-medium text-muted-fg">Then</p>
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
                                "bg-bg shadow-sm": ruleActionKind === kind,
                              })}
                              key={kind}
                              onClick={() => setRuleActionKind(kind)}
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
                                className={cn({ "bg-bg shadow-sm": ruleReadState === read })}
                                key={String(read)}
                                onClick={() => setRuleReadState(read)}
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
                            {(["archive", "inbox", "spam", "trash"] as const).map((destination) => (
                              <Button
                                aria-pressed={ruleMoveDestination === destination}
                                className={cn({
                                  "bg-bg shadow-sm": ruleMoveDestination === destination,
                                })}
                                key={destination}
                                onClick={() => setRuleMoveDestination(destination)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {destination === "inbox"
                                  ? "Move to Inbox"
                                  : `Move to ${destination[0]?.toUpperCase()}${destination.slice(1)}`}
                              </Button>
                            ))}
                          </div>
                        ) : null}
                        {ruleActionKind === "forward" ? (
                          <Input
                            aria-label="Forward recipients"
                            onChange={(event) => setRuleForwardRecipients(event.target.value)}
                            placeholder="Forward to email addresses"
                            size="sm"
                            value={ruleForwardRecipients}
                          />
                        ) : null}
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={ruleStopsProcessing}
                            onCheckedChange={setRuleStopsProcessing}
                          >
                            <CheckboxIndicator />
                          </Checkbox>
                          Stop evaluating later rules after this match
                        </label>
                      </div>
                      <div className="squircle space-y-2 rounded-lg bg-secondary/40 p-3">
                        <p className="text-xs font-medium text-muted-fg">Labels</p>
                        {(labelsData ?? []).flatMap((label) =>
                          label.type === "user"
                            ? [
                                <label className="flex items-center gap-2 text-sm" key={label.id}>
                                  <Checkbox
                                    checked={selectedRuleLabelIdSet.has(label.id)}
                                    onCheckedChange={(checked) =>
                                      setSelectedRuleLabelIds((current) =>
                                        checked
                                          ? [...current, label.id]
                                          : current.filter((labelId) => labelId !== label.id),
                                      )
                                    }
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
                            : [],
                        )}
                      </div>
                      {preview ? (
                        <p className="text-sm text-muted-fg">
                          {preview.count} matching conversation
                          {preview.count === 1 ? "" : "s"}
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          disabled={
                            !ruleName.trim() ||
                            !ruleQuery.trim() ||
                            (ruleActionKind === "set-labels" &&
                              selectedRuleLabelIds.length === 0) ||
                            (ruleActionKind === "forward" && !ruleForwardRecipients.trim()) ||
                            previewRuleMutation.isPending
                          }
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
                            !ruleName.trim() ||
                            !ruleQuery.trim() ||
                            (ruleActionKind === "set-labels" &&
                              selectedRuleLabelIds.length === 0) ||
                            (ruleActionKind === "forward" && !ruleForwardRecipients.trim()) ||
                            createRuleMutation.isPending ||
                            editingRuleUpdatePending
                          }
                          onClick={() => void saveRule()}
                          pending={createRuleMutation.isPending || editingRuleUpdatePending}
                          pendingLabel={editingRuleId ? "Updating…" : "Saving…"}
                          size="sm"
                          type="button"
                        >
                          {editingRuleId ? "Update rule" : "Save rule"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-5 divide-y">
                      {(rulesData ?? []).map((rule, index, rules) => (
                        <div className="flex items-center gap-3 py-2" key={rule.id}>
                          <HugeiconsIcon
                            aria-hidden
                            className="size-4 text-muted-fg"
                            icon={Tag01Icon}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{rule.name}</p>
                            <p className="text-xs text-muted-fg">
                              {rule.enabled ? "Enabled" : "Disabled"} /{" "}
                              {getRuleActionLabel(
                                getManagedMailboxRuleActions({
                                  actions: rule.actions,
                                  labelIds: rule.labelIds,
                                }),
                              )}
                            </p>
                          </div>
                          <Switch
                            aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                            checked={rule.enabled}
                            className="h-5 w-9 shrink-0 p-0.5"
                            disabled={isRowActionPending("rule", rule.id, "update")}
                            pending={isRowActionPending("rule", rule.id, "update")}
                            onCheckedChange={(enabled) => {
                              const conditionGroups = getRuleConditionGroups(rule.conditionGroups);
                              if (
                                rule.conditionGroups !== null &&
                                rule.conditionGroups !== undefined &&
                                conditionGroups === undefined
                              ) {
                                toast.error("This rule has invalid condition groups.");
                                return;
                              }
                              void runRowAction("rule", rule.id, "update", () =>
                                updateRuleMutation.mutateAsync({
                                  definition: {
                                    enabled,
                                    actions: getManagedMailboxRuleActions({
                                      actions: rule.actions,
                                      labelIds: rule.labelIds,
                                    }),
                                    conditionGroups,
                                    labelIds: rule.labelIds,
                                    matchMode: rule.matchMode,
                                    name: rule.name,
                                    search: structuredMailSearchSchema.parse(rule.search),
                                  },
                                  mailboxId,
                                  ruleId: rule.id,
                                }),
                              )
                                .then(invalidateRules)
                                .catch((error) =>
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Could not update rule.",
                                  ),
                                );
                            }}
                          >
                            <SwitchThumb className="size-4 data-checked:translate-x-4" />
                          </Switch>
                          <IconButtonTooltip label={`Edit ${rule.name}`}>
                            <Button
                              aria-label={`Edit ${rule.name}`}
                              onClick={() => {
                                setEditingRuleId(rule.id);
                                setRuleName(rule.name);
                                setRuleQueryDraft(
                                  serializeStructuredSearchState(
                                    structuredMailSearchSchema.parse(rule.search),
                                  ),
                                );
                                setRuleMatchMode(rule.matchMode);
                                setSelectedRuleLabelIds(rule.labelIds);
                                ruleConditionGroupsRef.current = getRuleConditionGroups(
                                  rule.conditionGroups,
                                );
                                const actions = getManagedMailboxRuleActions({
                                  actions: rule.actions,
                                  labelIds: rule.labelIds,
                                });
                                const action = getPrimaryRuleAction(actions);
                                if (action?.kind === "set-read") {
                                  setRuleActionKind("set-read");
                                  setRuleReadState(action.read);
                                } else if (action?.kind === "move") {
                                  setRuleActionKind("move");
                                  setRuleMoveDestination(action.destination);
                                } else if (action?.kind === "forward") {
                                  setRuleActionKind("forward");
                                  setRuleForwardRecipients(action.recipients.join(", "));
                                } else {
                                  setRuleActionKind("set-labels");
                                }
                                setRuleStopsProcessing(
                                  actions.some((candidate) => candidate.kind === "stop-processing"),
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
                              disabled={
                                index === 0 || isRowActionPending("rule", rule.id, "reorder")
                              }
                              pending={isRowActionPending("rule", rule.id, "reorder")}
                              onClick={() => {
                                const ruleIds = rules.map((candidate) => candidate.id);
                                [ruleIds[index - 1], ruleIds[index]] = [
                                  ruleIds[index],
                                  ruleIds[index - 1],
                                ];
                                void runRowAction("rule", rule.id, "reorder", () =>
                                  reorderRulesMutation.mutateAsync({ mailboxId, ruleIds }),
                                )
                                  .then(invalidateRules)
                                  .catch((error) =>
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : "Could not reorder rules.",
                                    ),
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
                                index === rules.length - 1 ||
                                isRowActionPending("rule", rule.id, "reorder")
                              }
                              pending={isRowActionPending("rule", rule.id, "reorder")}
                              onClick={() => {
                                const ruleIds = rules.map((candidate) => candidate.id);
                                [ruleIds[index], ruleIds[index + 1]] = [
                                  ruleIds[index + 1],
                                  ruleIds[index],
                                ];
                                void runRowAction("rule", rule.id, "reorder", () =>
                                  reorderRulesMutation.mutateAsync({ mailboxId, ruleIds }),
                                )
                                  .then(invalidateRules)
                                  .catch((error) =>
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : "Could not reorder rules.",
                                    ),
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
                                void runRowAction("rule", rule.id, "backfill", () =>
                                  backfillMutation.mutateAsync({ mailboxId, ruleId: rule.id }),
                                )
                                  .then((backfill) => {
                                    setActiveBackfillId(backfill.id);
                                    toast.success("Historical rule run started.");
                                  })
                                  .catch((error) =>
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : "Could not start the historical rule run.",
                                    ),
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
                                void runRowAction("rule", rule.id, "delete", () =>
                                  deleteRuleMutation.mutateAsync({ mailboxId, ruleId: rule.id }),
                                )
                                  .then(invalidateRules)
                                  .catch((error) =>
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : "Could not delete rule.",
                                    ),
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
                      ))}
                    </div>
                    {backfillData ? (
                      <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">Historical rule run</p>
                            <p className="text-xs text-muted-fg">
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
                                void cancelBackfillMutation
                                  .mutateAsync({
                                    backfillId: backfillData.id,
                                    mailboxId,
                                  })
                                  .catch((error) =>
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : "Could not cancel the historical rule run.",
                                    ),
                                  );
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Cancel
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-fg capitalize">
                              {backfillData.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-5 text-sm text-muted-fg">
                    Mailbox managers configure automatic rules.
                  </p>
                )}
              </section>
            </div>
          </FullPageDialogBody>
        </FullPageDialogContent>
      </FullPageDialog>
      <Dialog
        onOpenChange={(open) => {
          if (!open) setEditingView(null);
        }}
        open={!!editingView}
      >
        <DialogContent className="w-[min(92vw,24rem)] border-0 bg-popover shadow-lg">
          <form
            action={() => {
              void saveViewEdit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit saved view</DialogTitle>
              <DialogDescription>Change its name and sidebar color.</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-5 bg-secondary/25">
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input
                  autoFocus
                  className="border-0 bg-bg/70 shadow-none"
                  disabled={editingViewUpdatePending}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setEditingView((current) => (current ? { ...current, name } : current));
                  }}
                  value={editingView?.name ?? ""}
                />
              </Field>
              <Field>
                <FieldLabel>Color</FieldLabel>
                <MailboxColorPicker
                  label="Saved view color"
                  onChange={(color) =>
                    setEditingView((current) => (current ? { ...current, color } : current))
                  }
                  value={editingView?.color ?? "gray"}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton variant="ghost">Cancel</DialogCloseButton>
              <Button
                disabled={editingViewUpdatePending || !editingView?.name.trim()}
                pending={editingViewUpdatePending}
                pendingLabel="Saving…"
                size="sm"
                type="submit"
              >
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
