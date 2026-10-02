"use client";

import type { RouterOutputs } from "@quieter/orpc";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";
import { persistQueryByKey } from "#/lib/query-persister";

import { SettingsRow, SettingsRows, SettingsSection } from "./settings-layout";

type AiSettings = RouterOutputs["ai"]["settings"];
type UpdateSettings = (updater: (current: AiSettings) => AiSettings) => void;

const useAiSettingsData = () => {
  const queryClient = useQueryClient();
  const settingsQuery = orpc.ai.settings.queryOptions();
  const { data: settings, isPending } = useQuery(settingsQuery);
  const updateSettings: UpdateSettings = (updater) => {
    queryClient.setQueryData<AiSettings>(settingsQuery.queryKey, (current) =>
      current ? updater(current) : current
    );
    void persistQueryByKey(settingsQuery.queryKey, queryClient);
  };
  return { isPending, settings, updateSettings };
};

const AiPersonalizationSection = ({
  settings,
  updateSettings,
}: ReturnType<typeof useAiSettingsData>) => {
  const [resetOpen, setResetOpen] = useState(false);
  const updateMutation = useMutation(
    orpc.ai.updatePersonalization.mutationOptions()
  );
  const resetMutation = useMutation(
    orpc.ai.resetPersonalization.mutationOptions()
  );
  const enabled = settings?.memory.enabled ?? true;

  const updateEnabled = (nextEnabled: boolean) => {
    if (!settings) {
      return;
    }
    updateSettings((current) => ({
      ...current,
      memory: { ...current.memory, enabled: nextEnabled },
    }));
    updateMutation.mutate(
      { enabled: nextEnabled, revision: settings.memory.revision },
      {
        onError(error) {
          updateSettings((current) => ({
            ...current,
            memory: { ...current.memory, enabled },
          }));
          toastError(error, {
            boundary: "ai-settings",
            fallback: "Could not update personalization.",
          });
        },
        onSuccess(memory) {
          updateSettings((current) => ({ ...current, memory }));
        },
      }
    );
  };

  const reset = () => {
    resetMutation.mutate(undefined, {
      onError(error) {
        toastError(error, {
          boundary: "ai-settings",
          fallback: "Could not reset personalization.",
        });
      },
      onSuccess() {
        toast.success("Personalization has been reset.");
      },
    });
    setResetOpen(false);
  };

  return (
    <>
      <SettingsSection
        description="Quieter can quietly adapt to how you communicate and work. It recalls only the context that fits the task and lets weak, outdated patterns fade."
        title="Personalization"
      >
        <SettingsRows>
          <SettingsRow
            action={
              <Switch
                aria-label="Adaptive personalization"
                checked={enabled}
                disabled={!settings || updateMutation.isPending}
                onCheckedChange={updateEnabled}
              >
                <SwitchThumb />
              </Switch>
            }
            title="Adapt over time"
          >
            Learn useful patterns from conversations and the way you handle
            mail. Ask Quieter in chat what it knows, or tell it to forget or
            correct something.
          </SettingsRow>
          <SettingsRow
            action={
              <Button
                disabled={resetMutation.isPending}
                onClick={() => {
                  setResetOpen(true);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Start fresh
              </Button>
            }
            title="Reset personalization"
          >
            Clear the context Quieter has learned about you. New patterns can
            form again while adaptation is on.
          </SettingsRow>
        </SettingsRows>
      </SettingsSection>

      <AlertDialog onOpenChange={setResetOpen} open={resetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start personalization fresh?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently clears the context Quieter has learned about you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody>
            <p className="text-body text-muted-fg">
              Shared mailbox behavior is not affected. You can also ask Quieter
              to forget or correct individual things in chat.
            </p>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCloseButton disabled={resetMutation.isPending}>
              Cancel
            </AlertDialogCloseButton>
            <Button
              disabled={resetMutation.isPending}
              onClick={reset}
              type="button"
              variant="destructive"
            >
              Start fresh
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export const AiSettingsPanel = () => {
  const settingsData = useAiSettingsData();
  return (
    <div className="flex flex-col gap-8">
      <AiPersonalizationSection {...settingsData} />
    </div>
  );
};
