"use client";

import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { PersonalizationMemories } from "@quieter/app/features/settings/components/personalization-memories";
import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { persistQueryByKey } from "@quieter/app/lib/query-persister";
import type { RouterOutputs } from "@quieter/orpc";
import {
  AlertDialog,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export const AiSettingsPanel = () => {
  const queryClient = useQueryClient();
  const [resetOpen, setResetOpen] = useState(false);
  const settingsQuery = orpc.ai.settings.queryOptions();
  const settings = useQuery(settingsQuery);
  const update = useMutation(
    orpc.ai.updatePersonalization.mutationOptions({
      onError(error) {
        toastError(error, { boundary: "ai-settings" });
      },
      onSuccess(memory) {
        queryClient.setQueryData<RouterOutputs["ai"]["settings"]>(
          settingsQuery.queryKey,
          (current) =>
            current
              ? { ...current, memory: { ...current.memory, ...memory } }
              : current
        );
        void persistQueryByKey(settingsQuery.queryKey, queryClient);
      },
    })
  );
  const reset = useMutation(
    orpc.ai.resetPersonalization.mutationOptions({
      onError(error) {
        toastError(error, { boundary: "ai-settings" });
      },
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.ai.memories.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.ai.settings.key() }),
        ]);
        setResetOpen(false);
        toast.success("Memories deleted.");
      },
    })
  );
  const retrySettings = async () => {
    const result = await settings.refetch();
    if (result.error) {
      toastError(result.error, { boundary: "ai-settings" });
    }
  };

  if (settings.isPending) {
    return <SettingsLoadingState label="Loading memories" />;
  }
  if (settings.isError) {
    return (
      <SettingsErrorState
        message="Could not load memories."
        onRetry={() => {
          void retrySettings();
        }}
      />
    );
  }

  return (
    <SettingsSection>
      <PersonalizationMemories
        actions={
          <DropdownMenu>
            <IconButtonTooltip label="Memory settings">
              <DropdownMenuTrigger
                aria-label="Memory settings"
                appearance="icon"
              >
                <Icon aria-hidden icon={MoreHorizontalIcon} />
              </DropdownMenuTrigger>
            </IconButtonTooltip>
            <DropdownMenuContent align="end" size="compact">
              <DropdownMenuCheckboxItem
                checked={settings.data.memory.enabled}
                disabled={update.isPending}
                onCheckedChange={(enabled) => {
                  update.mutate({
                    enabled,
                    revision: settings.data.memory.revision,
                  });
                }}
              >
                Learn automatically
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setResetOpen(true);
                }}
                tone="destructive"
              >
                Delete all memories
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <AlertDialog
        onOpenChange={(open) => {
          if (!reset.isPending) {
            setResetOpen(open);
          }
        }}
        open={resetOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all memories?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes what Quieter remembers about you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCloseButton disabled={reset.isPending}>
              Cancel
            </AlertDialogCloseButton>
            <Button
              disabled={reset.isPending}
              onClick={() => {
                reset.mutate();
              }}
              pending={reset.isPending}
              pendingLabel="Deleting"
              variant="destructive"
            >
              Delete all
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
};
