"use client";

import { PersonalizationMemories } from "@quieter/app/features/settings/components/personalization-memories";
import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { persistQueryByKey } from "@quieter/app/lib/query-persister";
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
import { Pill } from "@quieter/ui/pill";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type AiSettings = RouterOutputs["ai"]["settings"];
type UpdateSettings = (updater: (current: AiSettings) => AiSettings) => void;

const learningStatus = {
  completed: { action: "Reviewed", description: "Recent mail reviewed." },
  failed: {
    action: "Try again",
    description: "Could not learn from recent mail. Please try again.",
  },
  not_started: {
    action: "Learn from mail",
    description: "Review recent received and sent mail to get to know you.",
  },
  pending: {
    action: "Queued",
    description: "Queued. Learning will start shortly.",
  },
  processing: {
    action: "Learning",
    description: "Reviewing recent mail and writing examples.",
  },
};

const useAiSettingsData = () => {
  const queryClient = useQueryClient();
  const settingsQuery = orpc.ai.settings.queryOptions();
  const {
    data: settings,
    error,
    isError,
    isPending,
    refetch,
  } = useQuery({
    ...settingsQuery,
    refetchInterval: (query) =>
      query.state.data?.memory.enabled === true &&
      query.state.data.memory.learning.some(
        (mailbox) =>
          mailbox.status === "pending" ||
          mailbox.status === "processing" ||
          (mailbox.pendingCount > 0 && !mailbox.needsBalance)
      )
        ? 5000
        : false,
  });
  const updateSettings: UpdateSettings = (updater) => {
    queryClient.setQueryData<AiSettings>(settingsQuery.queryKey, (current) =>
      current ? updater(current) : current
    );
    void persistQueryByKey(settingsQuery.queryKey, queryClient);
  };
  return { error, isError, isPending, refetch, settings, updateSettings };
};

const AiMemoryLearning = ({ settings }: { settings: AiSettings }) => {
  const queryClient = useQueryClient();
  const learning = useMutation(
    orpc.ai.learnFromMail.mutationOptions({
      onError(error) {
        toastError(error, {
          boundary: "ai-settings",
          fallback: "Could not start learning from mail. Please try again.",
        });
      },
      async onSuccess() {
        await queryClient.invalidateQueries({
          queryKey: orpc.ai.settings.key(),
        });
        toast.success("Learning from recent mail is queued.");
      },
    })
  );

  if (settings.memory.learning.length === 0) {
    return null;
  }

  return (
    <SettingsSection
      description="Quieter starts with recent received and sent mail to learn about you and how you write. It keeps learning from new mail, your edits, and conversations."
      title="Learn from recent mail"
    >
      <SettingsRows>
        {settings.memory.learning.map((mailbox) => {
          let progress = "Learning is up to date.";
          let badge = "Up to date";
          if (mailbox.pendingCount > 0) {
            progress = `${mailbox.pendingCount} observations are still being learned.`;
            badge = "Learning";
          }
          if (mailbox.failedCount > 0) {
            progress =
              "Some learning could not finish and will retry automatically.";
          }
          if (mailbox.needsBalance) {
            progress = "Add AI credit to finish learning.";
            badge = "Needs credit";
          }
          const description =
            mailbox.status === "completed"
              ? `${mailbox.receivedCount} received messages and ${mailbox.sentCount} sent messages scanned. ${progress}`
              : (mailbox.lastError ??
                learningStatus[mailbox.status].description);
          return (
            <SettingsRow
              action={
                mailbox.status === "completed" ? (
                  <Pill tone={mailbox.pendingCount > 0 ? "neutral" : "success"}>
                    {badge}
                  </Pill>
                ) : (
                  <Button
                    disabled={
                      !settings.memory.enabled ||
                      mailbox.status === "pending" ||
                      mailbox.status === "processing" ||
                      learning.isPending
                    }
                    onClick={() => {
                      learning.mutate({ mailboxId: mailbox.mailboxId });
                    }}
                    pending={
                      learning.isPending &&
                      learning.variables.mailboxId === mailbox.mailboxId
                    }
                    pendingLabel="Queuing"
                    size="sm"
                    type="button"
                  >
                    {learningStatus[mailbox.status].action}
                  </Button>
                )
              }
              key={mailbox.mailboxId}
              title={mailbox.emailAddress}
            >
              {description}
              {!settings.memory.enabled && mailbox.status !== "completed"
                ? " Resume adaptation to continue learning."
                : ""}
            </SettingsRow>
          );
        })}
      </SettingsRows>
    </SettingsSection>
  );
};

const AiPersonalizationSection = ({
  settings,
  updateSettings,
}: ReturnType<typeof useAiSettingsData>) => {
  const queryClient = useQueryClient();
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
          updateSettings((current) => ({
            ...current,
            memory: { ...current.memory, ...memory },
          }));
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
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.ai.memories.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.ai.settings.key() }),
        ]);
        setResetOpen(false);
        toast.success("Personalization has been reset.");
      },
    });
  };

  return (
    <>
      <SettingsSection
        description="Quieter learns about your life, work, preferences, and writing style, including how you communicate with different people. You control what it remembers."
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
            Learn from received and sent mail, drafts, mail activity, and chat.
            Pausing stops new automatic learning. You can still add, edit, or
            delete memories yourself.
          </SettingsRow>
          <SettingsRow
            action={<PersonalizationMemories />}
            title="What Quieter remembers"
          >
            Search, add, edit, or delete what Quieter knows about you. You can
            also tell Quieter to remember or forget something in chat.
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
                variant="destructive"
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

      {settings ? <AiMemoryLearning settings={settings} /> : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!resetMutation.isPending) {
            setResetOpen(open);
          }
        }}
        open={resetOpen}
      >
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
  const retrySettings = async () => {
    const result = await settingsData.refetch();
    if (result.error) {
      toastError(result.error, { boundary: "ai-settings" });
    }
  };
  if (settingsData.isPending) {
    return <SettingsLoadingState label="Loading personalization" />;
  }
  if (settingsData.isError) {
    return (
      <SettingsErrorState
        message="Could not load personalization. Please try again."
        onRetry={() => {
          void retrySettings();
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <AiPersonalizationSection {...settingsData} />
    </div>
  );
};
