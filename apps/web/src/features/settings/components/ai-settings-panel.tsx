"use client";

import {
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AI_MEMORY_REQUEST_MAX_LENGTH } from "@quieter/ai/ai-memory";
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
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
} from "@quieter/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
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

import {
  SettingsCard,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-layout";

type AiSettings = RouterOutputs["ai"]["settings"];
type CloudModelSettings = AiSettings["models"];
type MemoryScope = AiSettings["memory"]["scopes"][number];

const memoryDateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

const formatMemoryDate = (value: Date | string) =>
  memoryDateFormatter.format(new Date(value));

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

type UpdateSettings = (updater: (current: AiSettings) => AiSettings) => void;

type LearningDraft = {
  activeLearningEnabled: boolean;
  revision: number;
  scopeKey: string;
  text: string;
};

type MemoryResponse = {
  scopeKey: string;
  text: string;
};

type MemoryTarget = {
  mailboxId?: string;
  scope: MemoryScope["kind"];
};

const showMutationError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message.trim() : "";
  toast.error(message.length > 0 ? message : fallback);
};

const useAiSettingsData = () => {
  const queryClient = useQueryClient();
  const settingsQuery = orpc.ai.settings.queryOptions();
  const { data: settings, isPending } = useQuery(settingsQuery);

  const updateSettings: UpdateSettings = (updater) => {
    queryClient.setQueryData<AiSettings>(settingsQuery.queryKey, (current) => {
      if (!current) {
        return current;
      }
      return updater(current);
    });
    void persistQueryByKey(settingsQuery.queryKey, queryClient);
  };

  const refreshSettings = () => {
    void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey });
  };

  return { isPending, refreshSettings, settings, updateSettings };
};

const useAiModelsController = ({
  isPending,
  settings,
  updateSettings,
}: {
  isPending: boolean;
  settings: AiSettings | undefined;
  updateSettings: UpdateSettings;
}) => {
  const defaultChatModel = useDefaultChatModel();
  const [cloudModelDraft, setCloudModelDraft] =
    useState<CloudModelSettings | null>(null);
  const updateModelsMutation = useMutation(
    orpc.ai.updateModels.mutationOptions()
  );
  const cloudModels = cloudModelDraft ??
    settings?.models ?? {
      autoLabel: defaultAutoLabelModel,
      usefulDetail: defaultUsefulDetailModel,
    };

  const updateCloudModels = (nextModels: CloudModelSettings) => {
    setCloudModelDraft(nextModels);
    updateModelsMutation.mutate(nextModels, {
      onError(error) {
        setCloudModelDraft(null);
        showMutationError(error, "Could not update AI models.");
      },
      onSuccess(models) {
        updateSettings((current) => ({ ...current, models }));
        setCloudModelDraft(null);
      },
    });
  };

  const updateCloudModel = (
    key: keyof CloudModelSettings,
    model: ChatModel
  ) => {
    updateCloudModels({ ...cloudModels, [key]: model });
  };

  return {
    cloudModels,
    cloudModelsDisabled: isPending || updateModelsMutation.isPending,
    defaultChatModel,
    updateCloudModel,
  };
};

const useAiMemoryMutationActions = ({
  memoryRequest,
  memoryTarget,
  selectedScope,
  setMemoryRequest,
  setMemoryResponse,
  updateScopeMemory,
}: {
  memoryRequest: string;
  memoryTarget: MemoryTarget | null;
  selectedScope: MemoryScope | undefined;
  setMemoryRequest: (value: string) => void;
  setMemoryResponse: (value: MemoryResponse | null) => void;
  updateScopeMemory: (scopeKey: string, memory: MemoryScope["memory"]) => void;
}) => {
  const [deleteMemoryOpen, setDeleteMemoryOpen] = useState(false);
  const interactMemoryMutation = useMutation(
    orpc.ai.interactMemory.mutationOptions()
  );
  const forgetMemoryMutation = useMutation(
    orpc.ai.forgetMemory.mutationOptions()
  );
  const undoMemoryMutation = useMutation(
    orpc.ai.undoMemoryChange.mutationOptions()
  );
  const deleteMemoryMutation = useMutation(
    orpc.ai.deleteMemory.mutationOptions()
  );
  const exportMemoryMutation = useMutation(
    orpc.ai.exportMemory.mutationOptions()
  );
  const memoryMutationPending =
    interactMemoryMutation.isPending ||
    forgetMemoryMutation.isPending ||
    undoMemoryMutation.isPending ||
    deleteMemoryMutation.isPending;

  const interactWithMemory = () => {
    if (!selectedScope || !memoryTarget || memoryRequest.trim().length === 0) {
      return;
    }
    interactMemoryMutation.mutate(
      { ...memoryTarget, request: memoryRequest.trim() },
      {
        onError(error) {
          showMutationError(error, "Could not update AI memory.");
        },
        onSuccess({ answer, memory }) {
          updateScopeMemory(selectedScope.key, memory);
          setMemoryResponse({ scopeKey: selectedScope.key, text: answer });
          setMemoryRequest("");
        },
      }
    );
  };

  const forgetMemory = (memoryId: string) => {
    if (!selectedScope || !memoryTarget) {
      return;
    }
    forgetMemoryMutation.mutate(
      { ...memoryTarget, memoryId },
      {
        onError(error) {
          showMutationError(error, "Could not forget memory.");
        },
        onSuccess({ memory, summary }) {
          updateScopeMemory(selectedScope.key, memory);
          toast.success(summary);
        },
      }
    );
  };

  const undoMemoryChange = (changeSetId: string) => {
    if (!selectedScope || !memoryTarget) {
      return;
    }
    undoMemoryMutation.mutate(
      { ...memoryTarget, changeSetId },
      {
        onError(error) {
          showMutationError(error, "Could not undo this change.");
        },
        onSuccess({ memory, summary }) {
          updateScopeMemory(selectedScope.key, memory);
          toast.success(summary);
        },
      }
    );
  };

  const deleteAllMemory = () => {
    if (!selectedScope || !memoryTarget) {
      return;
    }
    deleteMemoryMutation.mutate(memoryTarget, {
      onError(error) {
        showMutationError(error, "Could not delete AI memory.");
      },
      onSuccess({ memory }) {
        updateScopeMemory(selectedScope.key, memory);
        toast.success(`${selectedScope.name} memory deleted.`);
      },
    });
    setDeleteMemoryOpen(false);
  };

  const exportMemory = () => {
    if (!selectedScope || !memoryTarget) {
      return;
    }
    exportMemoryMutation.mutate(memoryTarget, {
      onError(error) {
        showMutationError(error, "Could not export AI memory.");
      },
      onSuccess(memoryExport) {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(memoryExport, null, 2)], {
            type: "application/json",
          })
        );
        const link = document.createElement("a");
        link.download = `quieter-${selectedScope.kind === "user" ? "personal" : "mailbox"}-memory.json`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      },
    });
  };

  return {
    deleteAllMemory,
    deleteMemoryMutation,
    deleteMemoryOpen,
    exportMemory,
    exportMemoryMutation,
    forgetMemory,
    interactMemoryMutation,
    interactWithMemory,
    memoryMutationPending,
    setDeleteMemoryOpen,
    undoMemoryChange,
  };
};

const useAiLearningController = ({
  memoryTarget,
  refreshSettings,
  selectedScope,
  updateSettings,
}: {
  memoryTarget: MemoryTarget | null;
  refreshSettings: () => void;
  selectedScope: MemoryScope | undefined;
  updateSettings: UpdateSettings;
}) => {
  const [learningDraft, setLearningDraft] = useState<LearningDraft | null>(
    null
  );
  const updateLearningMutation = useMutation(
    orpc.ai.updateLearningGuidance.mutationOptions()
  );
  let learning: LearningDraft | null = null;

  if (
    learningDraft &&
    selectedScope &&
    learningDraft.scopeKey === selectedScope.key &&
    learningDraft.revision === selectedScope.learning.revision
  ) {
    learning = learningDraft;
  } else if (selectedScope) {
    learning = {
      activeLearningEnabled: selectedScope.learning.activeLearningEnabled,
      revision: selectedScope.learning.revision,
      scopeKey: selectedScope.key,
      text: selectedScope.learning.learningPrompt,
    };
  }

  const learningChanged =
    selectedScope !== undefined &&
    learning !== null &&
    (learning.text !== selectedScope.learning.learningPrompt ||
      learning.activeLearningEnabled !==
        selectedScope.learning.activeLearningEnabled);

  const saveLearningGuidance = () => {
    if (!selectedScope || !memoryTarget || !learning) {
      return;
    }
    updateLearningMutation.mutate(
      {
        ...memoryTarget,
        activeLearningEnabled: learning.activeLearningEnabled,
        learningPrompt: learning.text,
        revision: selectedScope.learning.revision,
      },
      {
        onError(error) {
          setLearningDraft(null);
          refreshSettings();
          showMutationError(error, "Could not save learning guidance.");
        },
        onSuccess(nextLearning) {
          updateSettings((current) => ({
            ...current,
            memory: {
              scopes: current.memory.scopes.map((scope) =>
                scope.key === selectedScope.key
                  ? { ...scope, learning: nextLearning }
                  : scope
              ),
            },
          }));
          setLearningDraft(null);
          toast.success("Learning guidance saved.");
        },
      }
    );
  };

  return {
    learning,
    learningChanged,
    saveLearningGuidance,
    setLearningDraft,
    updateLearningMutation,
  };
};

const useAiMemoryController = ({
  refreshSettings,
  settings,
  updateSettings,
}: {
  refreshSettings: () => void;
  settings: AiSettings | undefined;
  updateSettings: UpdateSettings;
}) => {
  const [memoryRequest, setMemoryRequest] = useState("");
  const [memoryResponse, setMemoryResponse] = useState<MemoryResponse | null>(
    null
  );
  const [selectedScopeKey, setSelectedScopeKey] = useState("user");
  const selectedScope =
    settings?.memory.scopes.find((scope) => scope.key === selectedScopeKey) ??
    settings?.memory.scopes[0];
  const memoryTarget: MemoryTarget | null = selectedScope
    ? {
        mailboxId: selectedScope.mailboxId ?? undefined,
        scope: selectedScope.kind,
      }
    : null;

  const updateScopeMemory = (
    scopeKey: string,
    memory: MemoryScope["memory"]
  ) => {
    updateSettings((current) => ({
      ...current,
      memory: {
        scopes: current.memory.scopes.map((scope) =>
          scope.key === scopeKey ? { ...scope, memory } : scope
        ),
      },
    }));
  };

  const actions = useAiMemoryMutationActions({
    memoryRequest,
    memoryTarget,
    selectedScope,
    setMemoryRequest,
    setMemoryResponse,
    updateScopeMemory,
  });
  const learning = useAiLearningController({
    memoryTarget,
    refreshSettings,
    selectedScope,
    updateSettings,
  });

  return {
    ...actions,
    ...learning,
    memoryRequest,
    memoryResponse,
    selectedScope,
    selectedScopeKey,
    setMemoryRequest,
    setSelectedScopeKey,
  };
};

const useAiSettingsController = () => {
  const settingsData = useAiSettingsData();
  const models = useAiModelsController(settingsData);
  const memory = useAiMemoryController(settingsData);

  return { ...settingsData, ...models, ...memory };
};

type AiMemorySectionProps = ReturnType<typeof useAiMemoryController> & {
  settings: AiSettings | undefined;
};

const AiModelsSection = ({
  cloudModels,
  cloudModelsDisabled,
  defaultChatModel,
  updateCloudModel,
}: {
  cloudModels: CloudModelSettings;
  cloudModelsDisabled: boolean;
  defaultChatModel: ChatModel;
  updateCloudModel: (key: keyof CloudModelSettings, model: ChatModel) => void;
}) => (
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
            disabled={cloudModelsDisabled}
            onValueChange={(model) => {
              updateCloudModel("autoLabel", model);
            }}
            size="sm"
            value={cloudModels.autoLabel}
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
            disabled={cloudModelsDisabled}
            onValueChange={(model) => {
              updateCloudModel("usefulDetail", model);
            }}
            size="sm"
            value={cloudModels.usefulDetail}
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

const AiMemoryScopeAndPrompt = (props: AiMemorySectionProps) => {
  const {
    interactMemoryMutation,
    interactWithMemory,
    memoryMutationPending,
    memoryRequest,
    memoryResponse,
    selectedScope,
    setMemoryRequest,
    setSelectedScopeKey,
    settings,
  } = props;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">Memory scope</p>
          <p className="mt-1 text-sm text-muted-fg">
            {selectedScope?.description ?? "Loading memory scopes."}
          </p>
        </div>
        <Select
          onValueChange={(value) => {
            if (value !== null && value !== "") {
              setSelectedScopeKey(value);
            }
          }}
          value={selectedScope?.key ?? "user"}
        >
          <SelectTrigger aria-label="Memory scope" className="w-48" size="sm">
            <SelectValue placeholder="Select scope" />
          </SelectTrigger>
          <SelectContent align="end">
            {settings?.memory.scopes.map((scope) => (
              <SelectItem key={scope.key} value={scope.key}>
                {scope.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Field className="mt-5">
        <FieldLabel>Ask or update</FieldLabel>
        <FieldControl
          aria-label="Ask or update memory"
          className="h-auto min-h-24 resize-y p-3 text-sm/6"
          disabled={!selectedScope || memoryMutationPending}
          maxLength={AI_MEMORY_REQUEST_MAX_LENGTH}
          onChange={(event) => {
            setMemoryRequest(event.target.value);
          }}
          placeholder={
            selectedScope?.kind === "mailbox"
              ? "Ask what this mailbox knows, or say how Quieter should handle its email."
              : "Ask what Quieter knows about you, or give it a personal instruction."
          }
          render={<textarea />}
          value={memoryRequest}
        />
        <FieldDescription>
          {selectedScope?.canManage === true
            ? "Use natural language to ask questions, add instructions, correct knowledge, or forget something."
            : "Ask questions about this mailbox knowledge. Only mailbox managers can change it."}
        </FieldDescription>
      </Field>
      <div className="mt-4 flex justify-end">
        <Button
          disabled={
            !selectedScope || !memoryRequest.trim() || memoryMutationPending
          }
          onClick={interactWithMemory}
          size="sm"
          type="button"
        >
          {interactMemoryMutation.isPending && (
            <HugeiconsIcon
              aria-hidden
              className="animate-spin"
              icon={Loading03Icon}
            />
          )}
          Send
        </Button>
      </div>

      {memoryResponse && memoryResponse.scopeKey === selectedScope?.key && (
        <div className="mt-4 rounded-lg border border-border bg-bg-elevated/40 p-4 text-sm/6 text-fg">
          {memoryResponse.text}
        </div>
      )}
    </>
  );
};

const AiMemoryKnowledgeSection = (props: AiMemorySectionProps) => {
  const {
    exportMemory,
    exportMemoryMutation,
    forgetMemory,
    memoryMutationPending,
    selectedScope,
    setDeleteMemoryOpen,
  } = props;
  const scope = selectedScope;
  const memoryItems = scope?.memory.items ?? [];

  return (
    <div className="mt-6 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">Knowledge base</p>
          <p className="mt-1 text-xs text-muted-fg">
            {selectedScope?.memory.activeCount ?? 0} active,{" "}
            {selectedScope?.memory.archivedCount ?? 0} forgotten
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            disabled={!selectedScope || exportMemoryMutation.isPending}
            onClick={exportMemory}
            size="sm"
            type="button"
            variant="outline"
          >
            Export
          </Button>
          <Button
            disabled={
              selectedScope?.canManage !== true ||
              memoryMutationPending ||
              (selectedScope?.memory.activeCount === 0 &&
                selectedScope.memory.archivedCount === 0)
            }
            onClick={() => {
              setDeleteMemoryOpen(true);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Delete all
          </Button>
        </div>
      </div>

      {scope !== undefined && memoryItems.length > 0 ? (
        <div className="mt-4 flex flex-col gap-5">
          {(["instruction", "learned"] as const).map((kind) => {
            const items = memoryItems.filter((memory) => memory.kind === kind);
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={kind}>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-fg uppercase">
                  {kind === "instruction"
                    ? "Instructions"
                    : "Learned knowledge"}
                </p>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {items.map((memory) => (
                    <div
                      className="flex items-start justify-between gap-4 p-3"
                      key={memory.id}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-fg">{memory.content}</p>
                        <p className="mt-1 text-xs text-muted-fg">
                          Updated {formatMemoryDate(memory.updatedAt)}
                        </p>
                      </div>
                      {scope.canManage && (
                        <Button
                          disabled={memoryMutationPending}
                          onClick={() => {
                            forgetMemory(memory.id);
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Forget
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-fg">
          This scope has no durable instructions or learned knowledge yet.
        </p>
      )}
    </div>
  );
};

const AiMemoryLearningSection = (props: AiMemorySectionProps) => {
  const {
    learning,
    learningChanged,
    saveLearningGuidance,
    selectedScope,
    setLearningDraft,
    updateLearningMutation,
  } = props;

  return (
    <div className="mt-6 border-t border-border pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-fg">Active learning</p>
          <p className="mt-1 text-sm text-muted-fg">
            Learn durable patterns from sent messages, replies, feedback, and
            important mailbox actions. Raw message text is not stored in the
            knowledge base.
          </p>
        </div>
        <Switch
          aria-label="Active memory learning"
          checked={learning?.activeLearningEnabled ?? true}
          disabled={selectedScope?.canManage !== true}
          onCheckedChange={(checked) => {
            if (!selectedScope || !learning) {
              return;
            }
            setLearningDraft({ ...learning, activeLearningEnabled: checked });
          }}
        >
          <SwitchThumb />
        </Switch>
      </div>
      <Field className="mt-4">
        <FieldLabel>Learning guidance</FieldLabel>
        <FieldControl
          aria-label="Memory learning guidance"
          className="h-auto min-h-32 resize-y p-3 text-sm/6"
          disabled={
            selectedScope?.canManage !== true ||
            updateLearningMutation.isPending
          }
          maxLength={6000}
          onChange={(event) => {
            if (!selectedScope || !learning) {
              return;
            }
            setLearningDraft({ ...learning, text: event.target.value });
          }}
          placeholder="Describe which durable patterns Quieter should focus on learning."
          render={<textarea />}
          value={learning?.text ?? ""}
        />
        <FieldDescription>
          This prompt tunes what the memory writer notices. Privacy, evidence,
          and instruction precedence remain enforced.
        </FieldDescription>
      </Field>
      <div className="mt-4 flex justify-end">
        <Button
          disabled={
            selectedScope?.canManage !== true ||
            !learningChanged ||
            updateLearningMutation.isPending
          }
          onClick={saveLearningGuidance}
          size="sm"
          type="button"
        >
          {updateLearningMutation.isPending && (
            <HugeiconsIcon
              aria-hidden
              className="animate-spin"
              icon={Loading03Icon}
            />
          )}
          Save learning guidance
        </Button>
      </div>
    </div>
  );
};

const AiMemoryRecentChanges = (props: AiMemorySectionProps) => {
  const { memoryMutationPending, selectedScope, undoMemoryChange } = props;
  const recentChanges = selectedScope?.memory.recentChanges ?? [];

  return recentChanges.length > 0 ? (
    <div className="mt-6 border-t border-border pt-5">
      <p className="text-sm font-medium text-fg">Recent changes</p>
      <div className="mt-3 flex flex-col gap-3">
        {recentChanges.map((change) => (
          <div
            className="flex items-start justify-between gap-4"
            key={change.id}
          >
            <div className="min-w-0">
              <p className="text-sm text-fg">{change.summary}</p>
              <p className="mt-1 text-xs text-muted-fg capitalize">
                {change.source.replaceAll("_", " ")} —{" "}
                {formatMemoryDate(change.createdAt)}
              </p>
            </div>
            {selectedScope?.canManage === true && change.canUndo && (
              <Button
                disabled={memoryMutationPending}
                onClick={() => {
                  undoMemoryChange(change.id);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Undo
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  ) : null;
};

const AiMemorySection = (props: AiMemorySectionProps) => (
  <SettingsSection
    description="Ask what Quieter knows, give it instructions, or correct what it has learned. Instructions and learned knowledge stay connected in the selected scope."
    title="Knowledge & memory"
  >
    <SettingsCard className="p-4 md:p-6">
      <AiMemoryScopeAndPrompt {...props} />
      <AiMemoryKnowledgeSection {...props} />
      <AiMemoryLearningSection {...props} />
      <AiMemoryRecentChanges {...props} />
    </SettingsCard>
  </SettingsSection>
);

type AiDeleteMemoryDialogProps = Pick<
  ReturnType<typeof useAiMemoryController>,
  | "deleteAllMemory"
  | "deleteMemoryMutation"
  | "deleteMemoryOpen"
  | "selectedScope"
  | "setDeleteMemoryOpen"
>;

const AiDeleteMemoryDialog = ({
  deleteAllMemory,
  deleteMemoryMutation,
  deleteMemoryOpen,
  selectedScope,
  setDeleteMemoryOpen,
}: AiDeleteMemoryDialogProps) => (
  <AlertDialog onOpenChange={setDeleteMemoryOpen} open={deleteMemoryOpen}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          Delete all {selectedScope?.name ?? "AI"} memory?
        </AlertDialogTitle>
        <AlertDialogDescription>
          This permanently removes both active and forgotten memory from this
          scope.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogBody>
        <p className="text-sm text-muted-fg">
          Future activity may build new knowledge again if active learning
          remains enabled. Learning guidance is not deleted.
        </p>
      </AlertDialogBody>
      <AlertDialogFooter>
        <AlertDialogCloseButton disabled={deleteMemoryMutation.isPending}>
          Cancel
        </AlertDialogCloseButton>
        <Button
          disabled={deleteMemoryMutation.isPending}
          onClick={deleteAllMemory}
          type="button"
          variant="destructive"
        >
          Delete memory
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export const AiSettingsPanel = () => {
  const controller = useAiSettingsController();

  return (
    <div className="flex flex-col gap-8">
      <AiModelsSection
        cloudModels={controller.cloudModels}
        cloudModelsDisabled={controller.cloudModelsDisabled}
        defaultChatModel={controller.defaultChatModel}
        updateCloudModel={controller.updateCloudModel}
      />
      <AiMemorySection {...controller} />
      <AiDeleteMemoryDialog {...controller} />
    </div>
  );
};
