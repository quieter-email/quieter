"use client";
import { structuredMailSearchSchema } from "@quieter/mail/search";
import type { parseStructuredSearchQuery } from "@quieter/mail/search";

import { toastError } from "#/lib/error-toast";

import type {
  PendingRowKind,
  PendingRowAction,
  ReorderScope,
  MailboxOrganizerState,
} from "./mailbox-organizer-types";

export const useMailboxViewActions = ({
  currentSearch,
  mailboxId,
  state,
}: {
  currentSearch: ReturnType<typeof parseStructuredSearchQuery>;
  mailboxId: string;
  state: MailboxOrganizerState;
}) => {
  const {
    createViewMutation,
    editingView,
    invalidateViews,
    newViewColor,
    runReorder,
    runRowAction,
    setEditingView,
    setNewViewColor,
    setViewName,
    updateViewMutation,
    viewName,
  } = state;

  const runViewRowAction = async <T,>(
    kind: PendingRowKind,
    id: string,
    action: PendingRowAction,
    operation: () => Promise<T>,
    fallback: string
  ) => {
    try {
      await runRowAction(kind, id, action, operation);
      await invalidateViews();
    } catch (error) {
      toastError(error, { boundary: "mailbox-organizer", fallback });
    }
  };

  const runViewReorder = async <T,>(
    scope: ReorderScope,
    rowId: string,
    operation: () => Promise<T>,
    fallback: string
  ) => {
    try {
      await runReorder(scope, rowId, operation);
      await invalidateViews();
    } catch (error) {
      toastError(error, { boundary: "mailbox-organizer", fallback });
    }
  };

  const saveView = async (shared: boolean) => {
    const name = viewName.trim();
    if (name.length === 0) {
      return;
    }
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
      toastError(error, {
        boundary: "mailbox-organizer",
        fallback: "Could not save view.",
      });
    }
  };

  const saveViewEdit = async () => {
    if (editingView === null || editingView.name.trim().length === 0) {
      return;
    }
    try {
      await runRowAction(
        "view",
        editingView.view.id,
        "update",
        async () =>
          await updateViewMutation.mutateAsync({
            definition: {
              color: editingView.color,
              icon: editingView.view.icon,
              name: editingView.name.trim(),
              search: structuredMailSearchSchema.parse(editingView.view.search),
              sort: editingView.view.sort,
            },
            mailboxId,
            viewId: editingView.view.id,
          })
      );
      setEditingView(null);
      await invalidateViews();
    } catch (error) {
      toastError(error, {
        boundary: "mailbox-organizer",
        fallback: "Could not update view.",
      });
    }
  };

  return {
    runViewReorder,
    runViewRowAction,
    saveView,
    saveViewEdit,
  };
};
