"use client";

import {
  ArrowLeft02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Delete01Icon,
  Edit01Icon,
  Search01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import {
  areStructuredMailSearchesEqual,
  parseStructuredSearchQuery,
  serializeStructuredSearchState,
  structuredMailSearchSchema,
} from "@quieter/mail/search";
import {
  Button,
  Checkbox,
  CheckboxIndicator,
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogDescription,
  FullPageDialogHeader,
  FullPageDialogTitle,
  IconButtonTooltip,
  Input,
  Switch,
  SwitchThumb,
  cn,
  toast,
} from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

const getSearchFromStoredValue = (value: unknown) => structuredMailSearchSchema.parse(value);

export const ManagedMailboxOrganizer = ({
  canManage,
  mailboxId,
  onSearch,
  searchQuery,
}: ManagedMailboxOrganizerProps) => {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [ruleQuery, setRuleQuery] = useState(searchQuery);
  const [ruleMatchMode, setRuleMatchMode] = useState<"all" | "any">("all");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [selectedRuleLabelIds, setSelectedRuleLabelIds] = useState<string[]>([]);
  const [activeBackfillId, setActiveBackfillId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; samples: Array<{ id: string }> } | null>(
    null,
  );
  const viewsQuery = useQuery(managedSavedViewsQueryOptions(mailboxId));
  const rulesQuery = useQuery(managedRulesQueryOptions(mailboxId, isOpen && canManage));
  const labelsQuery = useQuery(labelsQueryOptions(mailboxId, isOpen));
  const backfillQuery = useQuery({
    enabled: !!activeBackfillId,
    queryFn: ({ signal }) =>
      rpc.mail.getManagedRuleBackfill({ backfillId: activeBackfillId!, mailboxId }, { signal }),
    queryKey: ["managed-rule-backfill", mailboxId, activeBackfillId],
    refetchInterval: (query) =>
      ["pending", "running"].includes(query.state.data?.status ?? "") ? 1000 : false,
  });
  const currentSearch = parseStructuredSearchQuery(searchQuery);
  const views = viewsQuery.data ?? [];
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

  const saveView = async (shared: boolean) => {
    const name = viewName.trim();
    if (!name) return;
    try {
      await createViewMutation.mutateAsync({
        definition: {
          color: null,
          icon: null,
          name,
          search: currentSearch,
          sort: "newest",
        },
        mailboxId,
        shared,
      });
      setViewName("");
      await invalidateViews();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save view.");
    }
  };

  const createRuleDefinition = () => ({
    enabled: true,
    labelIds: selectedRuleLabelIds,
    matchMode: ruleMatchMode,
    name: ruleName.trim(),
    search: parseStructuredSearchQuery(ruleQuery),
  });

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
    if (!ruleName.trim() || selectedRuleLabelIds.length === 0) return;
    try {
      if (editingRuleId) {
        await updateRuleMutation.mutateAsync({
          definition: createRuleDefinition(),
          mailboxId,
          ruleId: editingRuleId,
        });
      } else {
        await createRuleMutation.mutateAsync({
          definition: createRuleDefinition(),
          mailboxId,
        });
      }
      setRuleName("");
      setRuleQuery("");
      setRuleMatchMode("all");
      setSelectedRuleLabelIds([]);
      setEditingRuleId(null);
      setPreview(null);
      await invalidateRules();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save rule.");
    }
  };

  const renderViews = (title: string, sectionViews: typeof views, emptyMessage: string) => (
    <section className="mt-4">
      <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">{title}</p>
      {sectionViews.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        <nav aria-label={title} className="flex flex-col">
          {sectionViews.map((view) => {
            const search = getSearchFromStoredValue(view.search);
            const active = areStructuredMailSearchesEqual(currentSearch, search);
            return (
              <SidebarNavItem
                active={active}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "h-7 w-full min-w-0 justify-start gap-2 rounded-md px-2.5 text-left text-xs font-light squircle",
                  {
                    "text-foreground": active,
                    "text-muted-foreground": !active,
                  },
                )}
                key={view.id}
                onClick={() => onSearch(serializeStructuredSearchState(search))}
                size="sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon aria-hidden className="size-3.5 shrink-0" icon={Search01Icon} />
                <span className="truncate">{view.name}</span>
              </SidebarNavItem>
            );
          })}
        </nav>
      )}
    </section>
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          {renderViews("Views", sharedViews, "No shared views.")}
          {renderViews("My views", personalViews, "No personal views.")}
        </div>
        <IconButtonTooltip label="Manage views and rules">
          <Button
            aria-label="Manage views and rules"
            className="mt-4 size-6 self-start text-muted-foreground hover:text-foreground"
            onClick={() => {
              setRuleQuery(searchQuery);
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
                <div className="mt-5 flex gap-2">
                  <Input
                    aria-label="Saved view name"
                    onChange={(event) => setViewName(event.target.value)}
                    placeholder="View name"
                    size="sm"
                    value={viewName}
                  />
                  <Button
                    disabled={!viewName.trim() || createViewMutation.isPending}
                    onClick={() => void saveView(false)}
                    size="sm"
                    type="button"
                  >
                    Save mine
                  </Button>
                  {canManage ? (
                    <Button
                      disabled={!viewName.trim() || createViewMutation.isPending}
                      onClick={() => void saveView(true)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Save shared
                    </Button>
                  ) : null}
                </div>
                <div className="mt-5 divide-y">
                  {views.map((view, index) => (
                    <div className="flex items-center gap-3 py-2" key={view.id}>
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4 text-muted-foreground"
                        icon={Search01Icon}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{view.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {view.ownerUserId === null ? "Shared" : "Personal"}
                      </span>
                      {areStructuredMailSearchesEqual(
                        currentSearch,
                        getSearchFromStoredValue(view.search),
                      ) &&
                      (view.ownerUserId !== null || canManage) ? (
                        <Button
                          disabled={updateViewMutation.isPending}
                          onClick={() => {
                            void updateViewMutation
                              .mutateAsync({
                                definition: {
                                  color: view.color
                                    ? mailboxLabelColorSchema.parse(view.color)
                                    : null,
                                  icon: view.icon,
                                  name: view.name,
                                  search: currentSearch,
                                  sort: view.sort,
                                },
                                mailboxId,
                                viewId: view.id,
                              })
                              .then(invalidateViews);
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Update
                        </Button>
                      ) : null}
                      {view.ownerUserId === null ? (
                        <Button
                          disabled={createViewMutation.isPending}
                          onClick={() => {
                            void createViewMutation
                              .mutateAsync({
                                definition: {
                                  color: view.color
                                    ? mailboxLabelColorSchema.parse(view.color)
                                    : null,
                                  icon: view.icon,
                                  name: `${view.name} copy`,
                                  search: getSearchFromStoredValue(view.search),
                                  sort: view.sort,
                                },
                                mailboxId,
                                shared: false,
                              })
                              .then(invalidateViews);
                          }}
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
                          disabled={index === 0 || reorderViewsMutation.isPending}
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
                            void reorderViewsMutation
                              .mutateAsync({ mailboxId, viewIds })
                              .then(invalidateViews);
                          }}
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
                          disabled={index === views.length - 1 || reorderViewsMutation.isPending}
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
                            void reorderViewsMutation
                              .mutateAsync({ mailboxId, viewIds })
                              .then(invalidateViews);
                          }}
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
                            onClick={() => {
                              void deleteViewMutation
                                .mutateAsync({ mailboxId, viewId: view.id })
                                .then(invalidateViews);
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
                <h2 className="text-lg font-semibold tracking-tight">Automatic labels</h2>
                <FullPageDialogDescription className="mt-1">
                  Match new inbound mail with the same filters used by search.
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
                        onChange={(event) => setRuleQuery(event.target.value)}
                        placeholder="from:vendor@example.com subject:invoice"
                        size="sm"
                        value={ruleQuery}
                      />
                      <div className="grid grid-cols-2 rounded-lg bg-muted/40 p-0.5">
                        {(["all", "any"] as const).map((mode) => (
                          <Button
                            aria-pressed={ruleMatchMode === mode}
                            className={cn({
                              "bg-background shadow-sm": ruleMatchMode === mode,
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
                      <div className="space-y-2 rounded-lg border p-3">
                        <p className="text-xs font-medium text-muted-foreground">Apply labels</p>
                        {(labelsQuery.data ?? [])
                          .filter((label) => label.type === "user")
                          .map((label) => (
                            <label className="flex items-center gap-2 text-sm" key={label.id}>
                              <Checkbox
                                checked={selectedRuleLabelIds.includes(label.id)}
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
                                className="size-3.5 text-muted-foreground"
                                icon={Tag01Icon}
                              />
                              {label.name}
                            </label>
                          ))}
                      </div>
                      {preview ? (
                        <p className="text-sm text-muted-foreground">
                          {preview.count} matching conversation
                          {preview.count === 1 ? "" : "s"}
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          disabled={
                            !ruleName.trim() ||
                            !ruleQuery.trim() ||
                            selectedRuleLabelIds.length === 0 ||
                            previewRuleMutation.isPending
                          }
                          onClick={() => void previewRule()}
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
                            selectedRuleLabelIds.length === 0 ||
                            createRuleMutation.isPending
                          }
                          onClick={() => void saveRule()}
                          size="sm"
                          type="button"
                        >
                          {editingRuleId ? "Update rule" : "Save rule"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-5 divide-y">
                      {(rulesQuery.data ?? []).map((rule, index, rules) => (
                        <div className="flex items-center gap-3 py-2" key={rule.id}>
                          <HugeiconsIcon
                            aria-hidden
                            className="size-4 text-muted-foreground"
                            icon={Tag01Icon}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{rule.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {rule.enabled ? "Enabled" : "Disabled"}
                            </p>
                          </div>
                          <Switch
                            aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                            checked={rule.enabled}
                            className="h-5 w-9 shrink-0 p-0.5"
                            disabled={updateRuleMutation.isPending}
                            onCheckedChange={(enabled) => {
                              void updateRuleMutation
                                .mutateAsync({
                                  definition: {
                                    enabled,
                                    labelIds: rule.labelIds,
                                    matchMode: rule.matchMode,
                                    name: rule.name,
                                    search: structuredMailSearchSchema.parse(rule.search),
                                  },
                                  mailboxId,
                                  ruleId: rule.id,
                                })
                                .then(invalidateRules);
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
                                setRuleQuery(
                                  serializeStructuredSearchState(
                                    structuredMailSearchSchema.parse(rule.search),
                                  ),
                                );
                                setRuleMatchMode(rule.matchMode);
                                setSelectedRuleLabelIds(rule.labelIds);
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
                              disabled={index === 0 || reorderRulesMutation.isPending}
                              onClick={() => {
                                const ruleIds = rules.map((candidate) => candidate.id);
                                [ruleIds[index - 1], ruleIds[index]] = [
                                  ruleIds[index],
                                  ruleIds[index - 1],
                                ];
                                void reorderRulesMutation
                                  .mutateAsync({ mailboxId, ruleIds })
                                  .then(invalidateRules);
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
                                index === rules.length - 1 || reorderRulesMutation.isPending
                              }
                              onClick={() => {
                                const ruleIds = rules.map((candidate) => candidate.id);
                                [ruleIds[index], ruleIds[index + 1]] = [
                                  ruleIds[index + 1],
                                  ruleIds[index],
                                ];
                                void reorderRulesMutation
                                  .mutateAsync({ mailboxId, ruleIds })
                                  .then(invalidateRules);
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
                              disabled={backfillMutation.isPending}
                              onClick={() => {
                                void backfillMutation
                                  .mutateAsync({ mailboxId, ruleId: rule.id })
                                  .then((backfill) => {
                                    setActiveBackfillId(backfill.id);
                                    toast.success("Historical labeling started.");
                                  });
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
                              onClick={() => {
                                void deleteRuleMutation
                                  .mutateAsync({ mailboxId, ruleId: rule.id })
                                  .then(invalidateRules);
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
                    {backfillQuery.data ? (
                      <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">Historical labeling</p>
                            <p className="text-xs text-muted-foreground">
                              {backfillQuery.data.processedCount} processed{" "}
                              {backfillQuery.data.matchedCount} matched
                            </p>
                          </div>
                          {["pending", "running"].includes(backfillQuery.data.status) ? (
                            <Button
                              disabled={cancelBackfillMutation.isPending}
                              onClick={() => {
                                void cancelBackfillMutation.mutateAsync({
                                  backfillId: backfillQuery.data.id,
                                  mailboxId,
                                });
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Cancel
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground capitalize">
                              {backfillQuery.data.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-5 text-sm text-muted-foreground">
                    Mailbox managers configure automatic labels.
                  </p>
                )}
              </section>
            </div>
          </FullPageDialogBody>
        </FullPageDialogContent>
      </FullPageDialog>
    </>
  );
};
