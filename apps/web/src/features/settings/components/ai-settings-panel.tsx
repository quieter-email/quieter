"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { InformationCircleIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  defaultAutoLabelModel,
  defaultUsefulDetailModel,
  type ChatModel,
} from "@quieter/ai/chat-models";
import { Button } from "@quieter/ui/button";
import { Field, FieldControl, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { toast } from "@quieter/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AiModelSelect } from "~/features/ai/components/ai-model-select";
import {
  setDefaultChatModel,
  useDefaultChatModel,
} from "~/features/ai/domain/default-chat-model-setting";
import { orpc } from "~/lib/orpc";
import { SettingsCard, SettingsRow, SettingsRows, SettingsSection } from "./settings-layout";

type AiSettings = RouterOutputs["ai"]["settings"];
type CloudModelSettings = AiSettings["models"];

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
      <p className="font-medium text-foreground">Actual generation cost</p>
      <p className="mt-1 text-muted-foreground">
        Team credits cover the actual generation cost, including any available savings, plus a 15%
        processing and service fee.
      </p>
    </TooltipContent>
  </Tooltip>
);

export const AiSettingsPanel = () => {
  const queryClient = useQueryClient();
  const settingsQuery = orpc.ai.settings.queryOptions();
  const { data: settings, isPending } = useQuery(settingsQuery);
  const defaultChatModel = useDefaultChatModel();
  const [cloudModelDraft, setCloudModelDraft] = useState<CloudModelSettings | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<{
    markdown: string;
    revision: number;
  } | null>(null);
  const updateModelsMutation = useMutation(orpc.ai.updateModels.mutationOptions());
  const updateMemoryMutation = useMutation(orpc.ai.updateMemory.mutationOptions());
  const cloudModels = cloudModelDraft ??
    settings?.models ?? {
      autoLabel: defaultAutoLabelModel,
      usefulDetail: defaultUsefulDetailModel,
    };
  const memoryRevision = settings?.memory.revision ?? 0;
  const memoryMarkdown =
    memoryDraft?.revision === memoryRevision
      ? memoryDraft.markdown
      : (settings?.memory.markdown ?? "");
  const memoryChanged = !!settings && memoryMarkdown !== settings.memory.markdown;

  const updateCloudModels = (nextModels: CloudModelSettings) => {
    setCloudModelDraft(nextModels);
    updateModelsMutation.mutate(nextModels, {
      onError: (error) => {
        setCloudModelDraft(null);
        toast.error(
          error instanceof Error && error.message ? error.message : "Could not update AI models.",
        );
      },
      onSuccess: (models) => {
        queryClient.setQueryData<AiSettings>(settingsQuery.queryKey, (current) =>
          current ? { ...current, models } : current,
        );
        setCloudModelDraft(null);
      },
    });
  };

  const updateCloudModel = (key: keyof CloudModelSettings, model: ChatModel) => {
    updateCloudModels({ ...cloudModels, [key]: model });
  };

  const saveMemory = () => {
    updateMemoryMutation.mutate(
      { markdown: memoryMarkdown, revision: memoryRevision },
      {
        onError: (error) => {
          void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey });
          toast.error(
            error instanceof Error && error.message ? error.message : "Could not save AI memory.",
          );
        },
        onSuccess: (memory) => {
          queryClient.setQueryData<AiSettings>(settingsQuery.queryKey, (current) =>
            current ? { ...current, memory } : current,
          );
          setMemoryDraft(null);
          toast.success("AI memory saved.");
        },
      },
    );
  };

  const cloudModelsDisabled = isPending || updateModelsMutation.isPending;

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        description={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Set the models Quieter uses for conversations and email assistance.</span>
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
            The starting model for new conversations on this device. Choosing a model in chat also
            updates this default.
          </SettingsRow>
          <SettingsRow
            action={
              <AiModelSelect
                align="end"
                ariaLabel="Auto-labeling model"
                className="w-44 sm:w-56"
                disabled={cloudModelsDisabled}
                onValueChange={(model) => updateCloudModel("autoLabel", model)}
                size="sm"
                value={cloudModels.autoLabel}
              />
            }
            title="Auto-labeling"
          >
            Used when newly received messages are matched to your existing labels. This choice is
            saved to your account.
          </SettingsRow>
          <SettingsRow
            action={
              <AiModelSelect
                align="end"
                ariaLabel="Useful details model"
                className="w-44 sm:w-56"
                disabled={cloudModelsDisabled}
                onValueChange={(model) => updateCloudModel("usefulDetail", model)}
                size="sm"
                value={cloudModels.usefulDetail}
              />
            }
            title="Useful details"
          >
            Used to find time-sensitive details such as deliveries, reservations, and verification
            codes. This choice is saved to your account.
          </SettingsRow>
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        description="This is the one durable profile Quieter continuously refines from your explicit preferences and feedback. Chat, auto-labeling, and useful details all read this same context."
        title="AI memory"
      >
        <SettingsCard className="p-4 md:p-6">
          <Field>
            <FieldLabel>Saved context</FieldLabel>
            <FieldControl
              aria-label="Saved AI context"
              className="h-auto min-h-56 resize-y p-3 font-mono text-xs/5"
              disabled={isPending || updateMemoryMutation.isPending}
              maxLength={12_000}
              onChange={(event) =>
                setMemoryDraft({ markdown: event.target.value, revision: memoryRevision })
              }
              placeholder="No durable preferences have been learned yet."
              render={<textarea />}
              value={memoryMarkdown}
            />
            <FieldDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Edit the Markdown directly. Future feedback may refine it while preserving durable
                preferences.
              </span>
              <span className="font-mono tabular-nums">
                {memoryMarkdown.length.toLocaleString("en-US")} / 12,000
              </span>
            </FieldDescription>
          </Field>
          <div className="mt-4 flex justify-end">
            <Button
              disabled={!memoryChanged || updateMemoryMutation.isPending}
              onClick={saveMemory}
              size="sm"
              type="button"
            >
              {updateMemoryMutation.isPending && (
                <HugeiconsIcon aria-hidden className="animate-spin" icon={Loading03Icon} />
              )}
              Save memory
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
};
