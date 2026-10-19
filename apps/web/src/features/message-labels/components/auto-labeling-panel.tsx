"use client";

import { AiMagicIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import type {
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Pill } from "@quieter/ui/pill";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { AutoLabelEditor } from "#/features/message-labels/components/auto-label-editor";
import { AutoLabelLibrary } from "#/features/message-labels/components/auto-label-library";
import { AutoLabelSetup } from "#/features/message-labels/components/auto-label-setup";
import type { AutoLabelPreset } from "#/features/message-labels/domain/auto-label-presets";
import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";
import {
  getDemoLabelAutomation,
  saveDemoLabelAutomation,
} from "#/lib/demo-mail/label-automation";
import { toastError } from "#/lib/error-toast";
import { getLabelsQueryKey } from "#/lib/mail/labels-query";
import {
  getMailboxesQueryKey,
  mailboxesQueryOptions,
} from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";
import { isSandboxMailboxId } from "#/lib/sandbox-mailbox";

const getRuleSummary = (label: MailboxLabel) => {
  const settings = label.autoLabel;
  if (!settings) {
    return (
      label.inclusionCriteria || label.description || "AI uses the label name"
    );
  }
  const conditions = [
    ...(settings.senders.length > 0
      ? [
          `${settings.senders.length} sender${settings.senders.length === 1 ? "" : "s"}`,
        ]
      : []),
    ...(settings.domains.length > 0 ? [settings.domains.join(", ")] : []),
    ...(settings.keywords.length > 0 ? [settings.keywords.join(", ")] : []),
  ];
  if (conditions.length === 0) {
    return settings.prompt || "AI uses the label name and description";
  }
  return `${conditions.join(settings.matchMode === "all" ? " and " : " or ")}${settings.prompt ? ", then AI checks" : ""}`;
};

export const AutoLabelingPanel = ({
  canManage,
  labels,
  mailboxId,
  mailboxProvider,
  onNavigate,
}: {
  canManage: boolean;
  labels: MailboxLabel[];
  mailboxId: string;
  mailboxProvider: "gmail" | "managed";
  onNavigate: () => void;
}) => {
  const id = useId();
  const queryClient = useQueryClient();
  const isDemo = isSandboxMailboxId(mailboxId);
  const [demoEnabled, setDemoEnabled] = useState(
    () => getDemoLabelAutomation(mailboxId).enabled
  );
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [view, setView] = useState<"library" | "labels" | "setup">("library");
  const [preset, setPreset] = useState<AutoLabelPreset | null>(null);
  const selectedLabel =
    labels.find((label) => label.id === selectedLabelId) ?? labels.at(0);
  const { data: mailboxesData, isPending: areMailboxesPending } = useQuery(
    mailboxesQueryOptions(!isDemo)
  );
  const enabled = isDemo
    ? demoEnabled
    : (mailboxesData?.groups
        .flatMap((group) => group.mailboxes)
        .find((mailbox) => mailbox.id === mailboxId)?.autoLabelEnabled ??
      false);
  const { isPending: isTogglePending, mutateAsync: setEnabled } = useMutation(
    orpc.mail.setGmailAutoLabeling.mutationOptions()
  );
  const { isPending: isUpdatePending, mutateAsync: updateLabel } = useMutation(
    orpc.mail.updateLabelDetails.mutationOptions()
  );
  const { isPending: isCreatePending, mutateAsync: createLabel } = useMutation(
    orpc.mail.createLabel.mutationOptions()
  );
  const isSavePending = isUpdatePending || isCreatePending;
  let heading = "Auto-label library";
  let description = "A few good places to start. Make any of them yours.";
  if (view === "labels") {
    heading = "Your auto-labels";
    description = "Choose a label to edit its prompt and conditions.";
  } else if (view === "setup") {
    heading = preset ? `Customize ${preset.name}` : "Build your own";
    description = "Review the prompt and add conditions to narrow the match.";
  }
  const navigateTo = (nextView: typeof view) => {
    setView(nextView);
    onNavigate();
  };

  const toggleAutoLabeling = async (nextEnabled: boolean) => {
    try {
      if (isDemo) {
        const current = getDemoLabelAutomation(mailboxId);
        saveDemoLabelAutomation(mailboxId, {
          ...current,
          enabled: nextEnabled,
        });
        setDemoEnabled(nextEnabled);
      } else {
        await setEnabled({ enabled: nextEnabled, mailboxId });
      }
      await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
    } catch (error) {
      toastError(error, {
        boundary: "auto-labeling",
        fallback: "Could not update auto-labeling. Please try again.",
      });
    }
  };

  const saveSettings = async (
    label: MailboxLabel,
    autoLabel: AutoLabelSettings
  ): Promise<boolean> => {
    try {
      if (isDemo) {
        const current = getDemoLabelAutomation(mailboxId);
        saveDemoLabelAutomation(mailboxId, {
          ...current,
          labels: { ...current.labels, [label.id]: autoLabel },
        });
      } else {
        await updateLabel({
          autoLabel,
          description: label.description,
          inclusionCriteria: label.inclusionCriteria,
          labelId: label.id,
          mailboxId,
        });
      }
      await queryClient.invalidateQueries({
        queryKey: getLabelsQueryKey(mailboxId),
      });
      toast.success("Auto-label updated.");
      return true;
    } catch (error) {
      toastError(error, {
        boundary: "auto-labeling",
        fallback: "Could not save auto-labeling. Please try again.",
      });
      return false;
    }
  };

  const savePreset = async (input: {
    autoLabel: AutoLabelSettings;
    color: MailboxLabelColor;
    existingLabel: MailboxLabel | undefined;
    name: string;
    preset: AutoLabelPreset | null;
  }): Promise<boolean> => {
    if (input.existingLabel) {
      const success = await saveSettings(input.existingLabel, input.autoLabel);
      if (success) {
        setSelectedLabelId(input.existingLabel.id);
        navigateTo("labels");
      }
      return success;
    }
    try {
      let createdLabelId: string;
      if (isDemo) {
        const current = getDemoLabelAutomation(mailboxId);
        const demoLabel: MailboxLabel = {
          autoLabel: input.autoLabel,
          color: input.color,
          description: input.preset?.description ?? null,
          id: `demo:auto-label:${crypto.randomUUID()}`,
          inclusionCriteria: null,
          name: input.name,
          position: labels.length,
          provider: mailboxProvider,
          type: "user",
          visible: true,
        };
        saveDemoLabelAutomation(mailboxId, {
          ...current,
          createdLabels: [...current.createdLabels, demoLabel],
        });
        createdLabelId = demoLabel.id;
      } else {
        const label = await createLabel({
          autoLabel: input.autoLabel,
          color: input.color,
          description: input.preset?.description ?? null,
          mailboxId,
          name: input.name,
        });
        createdLabelId = label.id;
      }
      await queryClient.invalidateQueries({
        queryKey: getLabelsQueryKey(mailboxId),
      });
      setSelectedLabelId(createdLabelId);
      navigateTo("labels");
      return true;
    } catch (error) {
      toastError(error, {
        boundary: "auto-labeling",
        fallback: "Could not create auto-label. Please try again.",
      });
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-lg border border-border bg-bg-raised p-4">
        <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-fg sm:flex">
          <HugeiconsIcon aria-hidden className="size-4.5" icon={AiMagicIcon} />
        </span>
        <label
          className="min-w-0 flex-1 cursor-pointer"
          htmlFor={`${id}-auto-labeling`}
        >
          <span className="block text-body font-medium text-fg">
            Automatically label new mail
          </span>
          <span className="mt-1 block text-caption text-muted-fg">
            Use AI, specific conditions, or a little of both.
          </span>
        </label>
        <Switch
          checked={enabled}
          disabled={
            !canManage || isTogglePending || (!isDemo && areMailboxesPending)
          }
          id={`${id}-auto-labeling`}
          onCheckedChange={(nextEnabled) => {
            void toggleAutoLabeling(nextEnabled);
          }}
          size="sm"
        >
          <SwitchThumb />
        </Switch>
      </div>

      {enabled ? null : (
        <p className="text-caption text-muted-fg">
          Auto-labeling is off. You can set up your labels below, then turn it
          on when you are ready.
        </p>
      )}
      {canManage ? null : (
        <p className="text-caption text-muted-fg">
          A mailbox manager can change auto-labeling settings.
        </p>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-body-lg font-medium text-fg">{heading}</h2>
          <p className="mt-1 text-caption text-muted-fg">{description}</p>
        </div>
        {view === "setup" ? null : (
          <Button
            disabled={isSavePending}
            onClick={() => {
              navigateTo(view === "library" ? "labels" : "library");
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {view === "library" ? "Edit existing labels" : "Browse presets"}
          </Button>
        )}
      </div>

      {view === "library" ? (
        <AutoLabelLibrary
          canManage={canManage}
          labels={labels}
          onChoosePreset={(nextPreset) => {
            setPreset(nextPreset);
            navigateTo("setup");
          }}
        />
      ) : null}
      {view === "setup" ? (
        <AutoLabelSetup
          canManage={canManage}
          isPending={isSavePending}
          labels={labels}
          mailboxProvider={mailboxProvider}
          onBack={() => {
            navigateTo("library");
          }}
          onSave={savePreset}
          preset={preset}
        />
      ) : null}

      {view === "labels" && selectedLabel ? (
        <div className="grid gap-6 md:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)]">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-caption font-medium text-muted-fg">
                Your labels
              </h2>
              <span className="text-micro text-muted-fg tabular-nums">
                {labels.length}
              </span>
            </div>
            <div aria-label="Choose a label to configure" className="space-y-1">
              {labels.map((label) => (
                <Button
                  aria-pressed={selectedLabel.id === label.id}
                  data-active={selectedLabel.id === label.id}
                  disabled={isSavePending}
                  key={label.id}
                  onClick={() => {
                    setSelectedLabelId(label.id);
                  }}
                  type="button"
                  variant="result"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      mailboxLabelDotClassNameByColor[label.color ?? "gray"]
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-body text-fg">
                      <span className="truncate">{label.name}</span>
                      {label.autoLabel?.enabled === false ? (
                        <Pill size="xs">Paused</Pill>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-caption text-muted-fg">
                      {getRuleSummary(label)}
                    </span>
                  </span>
                  <HugeiconsIcon
                    aria-hidden
                    className="size-3.5"
                    icon={ArrowRight01Icon}
                  />
                </Button>
              ))}
            </div>
          </div>
          <AutoLabelEditor
            canManage={canManage}
            isPending={isSavePending}
            key={`${mailboxId}:${selectedLabel.id}:${JSON.stringify(selectedLabel.autoLabel)}`}
            label={selectedLabel}
            onSave={async (settings) =>
              await saveSettings(selectedLabel, settings)
            }
          />
        </div>
      ) : null}
      {view === "labels" && selectedLabel === undefined ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
          <h2 className="text-body font-medium text-fg">
            A label for the mail you want to find
          </h2>
          <p className="mt-2 text-body text-muted-fg">
            Create a label like Receipts, Newsletters, or Clients. Then decide
            what belongs there.
          </p>
          <div className="mt-5">
            <Button
              onClick={() => {
                navigateTo("library");
              }}
              type="button"
              variant="outline"
            >
              Browse presets
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
