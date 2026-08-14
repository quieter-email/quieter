"use client";

import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  defaultAutoLabelModel,
  defaultUsefulDetailModel,
} from "@quieter/ai/chat-models";
import type { ChatModel } from "@quieter/ai/chat-models";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AiModelSelect } from "#/features/ai/components/ai-model-select";
import {
  setDefaultChatModel,
  useDefaultChatModel,
} from "#/features/ai/domain/default-chat-model-setting";
import { orpc } from "#/lib/orpc";
import { persistQueryByKey } from "#/lib/query-persister";

import { SettingsRow, SettingsRows, SettingsSection } from "./settings-layout";

type AiSettings = RouterOutputs["ai"]["settings"];
type CloudModelSettings = AiSettings["models"];
type UpdateSettings = (updater: (current: AiSettings) => AiSettings) => void;

const showMutationError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message.trim() : "";
  toast.error(message.length > 0 ? message : fallback);
};

const ModelCostInfo = () => (
  <Tooltip>
    <TooltipTrigger
      closeOnClick={false}
      render={<Button size="sm" type="button" variant="ghost" />}
    >
      <HugeiconsIcon aria-hidden icon={InformationCircleIcon} />
      Model costs
    </TooltipTrigger>
    <TooltipContent className="max-w-sm p-3" side="bottom">
      <p className="font-medium text-fg">Actual generation cost</p>
      <p className="mt-1 text-muted-fg">
        Team credits cover the actual generation cost, including any available
        savings, plus a 15% processing and service fee.
      </p>
    </TooltipContent>
  </Tooltip>
);

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

const useAiModels = ({
  isPending,
  settings,
  updateSettings,
}: ReturnType<typeof useAiSettingsData>) => {
  const defaultChatModel = useDefaultChatModel();
  const [draft, setDraft] = useState<CloudModelSettings | null>(null);
  const mutation = useMutation(orpc.ai.updateModels.mutationOptions());
  const models = draft ??
    settings?.models ?? {
      autoLabel: defaultAutoLabelModel,
      usefulDetail: defaultUsefulDetailModel,
    };
  const updateModel = (key: keyof CloudModelSettings, model: ChatModel) => {
    const next = { ...models, [key]: model };
    setDraft(next);
    mutation.mutate(next, {
      onError(error) {
        setDraft(null);
        showMutationError(error, "Could not update AI models.");
      },
      onSuccess(savedModels) {
        updateSettings((current) => ({ ...current, models: savedModels }));
        setDraft(null);
      },
    });
  };
  return {
    defaultChatModel,
    disabled: isPending || mutation.isPending,
    models,
    updateModel,
  };
};

const AiModelsSection = ({
  defaultChatModel,
  disabled,
  models,
  updateModel,
}: ReturnType<typeof useAiModels>) => (
  <SettingsSection
    description={
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Set the models Quieter uses for conversations and email assistance.
        </span>
        <ModelCostInfo />
      </div>
    }
    title="Models"
  >
    <SettingsRows>
      <SettingsRow
        action={
          <AiModelSelect
            align="end"
            ariaLabel="Default chat model"
            className="w-44 sm:w-56"
            onValueChange={setDefaultChatModel}
            size="sm"
            value={defaultChatModel}
          />
        }
        title="New chats"
      >
        The starting model for new conversations on this device. Choosing a
        model in chat also updates this default.
      </SettingsRow>
      <SettingsRow
        action={
          <AiModelSelect
            align="end"
            ariaLabel="Auto-labeling model"
            className="w-44 sm:w-56"
            disabled={disabled}
            onValueChange={(model) => {
              updateModel("autoLabel", model);
            }}
            size="sm"
            value={models.autoLabel}
          />
        }
        title="Auto-labeling"
      >
        Used when newly received messages are matched to your existing labels.
        This choice is saved to your account.
      </SettingsRow>
      <SettingsRow
        action={
          <AiModelSelect
            align="end"
            ariaLabel="Useful details model"
            className="w-44 sm:w-56"
            disabled={disabled}
            onValueChange={(model) => {
              updateModel("usefulDetail", model);
            }}
            size="sm"
            value={models.usefulDetail}
          />
        }
        title="Useful details"
      >
        Used to find time-sensitive details such as deliveries, reservations,
        and verification codes. This choice is saved to your account.
      </SettingsRow>
    </SettingsRows>
  </SettingsSection>
);

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
          showMutationError(error, "Could not update personalization.");
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
        showMutationError(error, "Could not reset personalization.");
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
            <p className="text-sm text-muted-fg">
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
  const models = useAiModels(settingsData);
  return (
    <div className="flex flex-col gap-8">
      <AiModelsSection {...models} />
      <AiPersonalizationSection {...settingsData} />
    </div>
  );
};
