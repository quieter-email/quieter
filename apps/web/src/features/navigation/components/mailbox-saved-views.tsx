"use client";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete01Icon,
  Edit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import {
  structuredMailSearchSchema,
  areStructuredMailSearchesEqual,
  serializeStructuredSearchState,
} from "@quieter/mail/search";
import type { parseStructuredSearchQuery } from "@quieter/mail/search";
import { Button } from "@quieter/ui/button";
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
import { FullPageDialogDescription } from "@quieter/ui/full-page-dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";

import { MailboxColorPicker } from "#/features/message-labels/components/mailbox-color-picker";
import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";

import type {
  MailboxSavedView,
  ReorderScope,
  MailboxOrganizerContentProps,
} from "./mailbox-organizer-types";
import { SidebarNavItem } from "./sidebar-nav-item";

type SavedViewsSectionProps = {
  currentSearch: ReturnType<typeof parseStructuredSearchQuery>;
  emptyMessage: string;
  onSearch: (query: string) => void;
  title: string;
  views: MailboxSavedView[];
};

const getSavedViewColor = (color: string | null) =>
  color === null || color === ""
    ? "gray"
    : mailboxLabelColorSchema.parse(color);

export const SavedViewsSection = ({
  currentSearch,
  emptyMessage,
  onSearch,
  title,
  views,
}: SavedViewsSectionProps) => (
  <section className="mt-4">
    <p className="mb-1 px-2 text-caption font-medium text-muted-fg">{title}</p>
    {views.length === 0 ? (
      <p className="px-2 py-1 text-caption text-muted-fg">{emptyMessage}</p>
    ) : (
      <nav aria-label={title} className="flex flex-col">
        {views.map((view) => {
          const search = structuredMailSearchSchema.parse(view.search);
          const active = areStructuredMailSearchesEqual(currentSearch, search);
          return (
            <SidebarNavItem
              active={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "squircle h-7 w-full min-w-0 justify-start gap-2 rounded-md px-2.5 text-left text-caption font-light",
                {
                  "text-fg": active,
                  "text-muted-fg": !active,
                }
              )}
              key={view.id}
              disabled={view.disabledReason !== null}
              title={view.disabledReason ?? undefined}
              onClick={() => {
                onSearch(serializeStructuredSearchState(search));
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  mailboxLabelDotClassNameByColor[getSavedViewColor(view.color)]
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

export const MailboxSavedViewsPanel = (props: MailboxOrganizerContentProps) => {
  const {
    canManage,
    createViewMutation,
    currentSearch,
    deleteViewMutation,
    isRowActionPending,
    mailboxId,
    newViewColor,
    pendingReorders,
    reorderViewsMutation,
    runViewReorder,
    runViewRowAction,
    saveView,
    setEditingView,
    setNewViewColor,
    setViewName,
    supportsSharedViews,
    updateViewMutation,
    viewName,
    views,
  } = props;

  return (
    <section>
      <h2 className="text-body-lg font-semibold tracking-tight">Saved views</h2>
      <FullPageDialogDescription className="mt-1">
        Save the current search for quick access from the sidebar.
      </FullPageDialogDescription>
      <div className="squircle mt-5 rounded-xl bg-secondary/40 p-3">
        <div className="flex gap-2">
          <Input
            aria-label="Saved view name"
            className="border-0 bg-bg-raised/70 shadow-none"
            onChange={(event) => {
              setViewName(event.target.value);
            }}
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
          {canManage && supportsSharedViews ? (
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
        {views.map((view) => {
          const viewScope: ReorderScope =
            view.ownerUserId === null ? "views:shared" : "views:personal";
          const sameScopeViews = views.filter(
            (candidate) =>
              (candidate.ownerUserId === null) === (view.ownerUserId === null)
          );
          const scopeIndex = sameScopeViews.findIndex(
            (candidate) => candidate.id === view.id
          );
          const reorderLocked = pendingReorders[viewScope] !== undefined;
          const reorderPending = pendingReorders[viewScope] === view.id;

          return (
            <div
              className="squircle flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60"
              key={view.id}
            >
              <span
                aria-hidden
                className={cn(
                  "size-3 shrink-0 rounded-full",
                  mailboxLabelDotClassNameByColor[getSavedViewColor(view.color)]
                )}
              />
              <span className="min-w-0 flex-1 truncate text-body">
                {view.name}
              </span>
              {view.disabledReason ? (
                <span className="text-caption text-muted-fg">
                  {view.disabledReason}
                </span>
              ) : null}
              {supportsSharedViews ? (
                <span className="text-caption text-muted-fg">
                  {view.ownerUserId === null ? "Shared" : "Personal"}
                </span>
              ) : null}
              {(view.ownerUserId !== null || canManage) && (
                <IconButtonTooltip label={`Edit ${view.name}`}>
                  <Button
                    aria-label={`Edit ${view.name}`}
                    onClick={() => {
                      setEditingView({
                        color: getSavedViewColor(view.color),
                        name: view.name,
                        view,
                      });
                    }}
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
                      structuredMailSearchSchema.parse(view.search)
                    )
                  }
                  onClick={() => {
                    void runViewRowAction(
                      "view",
                      view.id,
                      "update",
                      async () =>
                        await updateViewMutation.mutateAsync({
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
                      "Could not update view."
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
                    void runViewRowAction(
                      "view",
                      view.id,
                      "duplicate",
                      async () =>
                        await createViewMutation.mutateAsync({
                          definition: {
                            color: getSavedViewColor(view.color),
                            icon: view.icon,
                            name: `${view.name} copy`,
                            search: structuredMailSearchSchema.parse(
                              view.search
                            ),
                            sort: view.sort,
                          },
                          mailboxId,
                          shared: false,
                        }),
                      "Could not duplicate view."
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
                  disabled={scopeIndex <= 0 || reorderLocked}
                  onClick={() => {
                    if (scopeIndex <= 0) {
                      return;
                    }
                    const viewIds = sameScopeViews.map(
                      (candidate) => candidate.id
                    );
                    [viewIds[scopeIndex - 1], viewIds[scopeIndex]] = [
                      viewIds[scopeIndex],
                      viewIds[scopeIndex - 1],
                    ];
                    void runViewReorder(
                      viewScope,
                      view.id,
                      async () =>
                        await reorderViewsMutation.mutateAsync({
                          mailboxId,
                          viewIds,
                        }),
                      "Could not reorder views."
                    );
                  }}
                  pending={reorderPending}
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
                    scopeIndex === sameScopeViews.length - 1 || reorderLocked
                  }
                  onClick={() => {
                    if (
                      scopeIndex === -1 ||
                      scopeIndex === sameScopeViews.length - 1
                    ) {
                      return;
                    }
                    const viewIds = sameScopeViews.map(
                      (candidate) => candidate.id
                    );
                    [viewIds[scopeIndex], viewIds[scopeIndex + 1]] = [
                      viewIds[scopeIndex + 1],
                      viewIds[scopeIndex],
                    ];
                    void runViewReorder(
                      viewScope,
                      view.id,
                      async () =>
                        await reorderViewsMutation.mutateAsync({
                          mailboxId,
                          viewIds,
                        }),
                      "Could not reorder views."
                    );
                  }}
                  pending={reorderPending}
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
                      void runViewRowAction(
                        "view",
                        view.id,
                        "delete",
                        async () =>
                          await deleteViewMutation.mutateAsync({
                            mailboxId,
                            viewId: view.id,
                          }),
                        "Could not delete view."
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
          );
        })}
      </div>
    </section>
  );
};

export const MailboxSavedViewEditDialog = (
  props: MailboxOrganizerContentProps
) => {
  const {
    editingView,
    editingViewUpdatePending,
    saveViewEdit,
    setEditingView,
  } = props;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setEditingView(null);
        }
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
            <DialogDescription>
              Change its name and sidebar color.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5 bg-secondary/25">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                className="border-0 bg-bg-raised/70 shadow-none"
                disabled={editingViewUpdatePending}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setEditingView((current) =>
                    current ? { ...current, name } : current
                  );
                }}
                value={editingView?.name ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel>Color</FieldLabel>
              <MailboxColorPicker
                label="Saved view color"
                onChange={(color) => {
                  setEditingView((current) =>
                    current ? { ...current, color } : current
                  );
                }}
                value={editingView?.color ?? "gray"}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton variant="ghost">Cancel</DialogCloseButton>
            <Button
              disabled={
                editingViewUpdatePending ||
                editingView === null ||
                editingView.name.trim() === ""
              }
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
  );
};
