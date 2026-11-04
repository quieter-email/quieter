"use client";

import {
  getActionsTriggerLabel,
  MailboxActionsReview,
} from "@quieter/app/features/settings/components/mailbox-actions-review";
import {
  SettingsCard,
  SettingsErrorState,
  SettingsLoadingState,
  SettingsRow,
  SettingsRowText,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { connectorMentionPattern } from "@quieter/orpc/mail-agent/contracts";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { PromptComposerFrame } from "@quieter/ui/composer-chrome";
import { Pill } from "@quieter/ui/pill";
import { TokenField } from "@quieter/ui/token-field";
import type { TokenFieldToken } from "@quieter/ui/token-field";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

type ActionsSettings = RouterOutputs["mailAgent"]["get"];

const MailboxActionsForm = ({
  data,
  mailboxId,
  onUpdate,
}: {
  data: ActionsSettings;
  mailboxId: string;
  onUpdate: (data: ActionsSettings) => void;
}) => {
  const [view, setView] = useState<"overview" | "editing" | "review">(
    data.active ? "overview" : "editing"
  );
  const [sourceText, setSourceText] = useState(
    data.draft?.specification.sourceText ??
      data.active?.specification.sourceText ??
      ""
  );
  const [acknowledgedRevisionId, setAcknowledgedRevisionId] = useState<
    string | null
  >(null);
  const acknowledgementId = useId();
  const review = useMutation({
    ...orpc.mailAgent.review.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "mailbox-actions-review" });
    },
    onSuccess: (updated) => {
      setAcknowledgedRevisionId(null);
      setView("review");
      onUpdate(updated);
    },
  });
  const activate = useMutation({
    ...orpc.mailAgent.activate.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "mailbox-actions-activate" });
    },
    onSuccess: (updated) => {
      setView("overview");
      onUpdate(updated);
    },
  });
  const pause = useMutation({
    ...orpc.mailAgent.pause.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "mailbox-actions-pause" });
    },
    onSuccess: onUpdate,
  });
  const pending = review.isPending || activate.isPending || pause.isPending;
  const reviewed =
    data.draft?.specification.sourceText.trim() === sourceText.trim()
      ? data.draft
      : null;
  const isCurrentActive = reviewed?.id === data.active?.id;
  const canActivate =
    reviewed !== null &&
    reviewed.canActivate &&
    (reviewed.specification.review.assumptions.length === 0 ||
      acknowledgedRevisionId === reviewed.id) &&
    !(isCurrentActive && data.setting.enabled);
  const tokens: TokenFieldToken[] = data.accounts.map((account) => ({
    description:
      account.status === "connected" ? "Connected account" : "Unavailable",
    id: account.connectionId,
    label: account.label,
    text: `@[connection:${account.connectionId}]`,
    tone: account.status === "connected" ? "purple" : "orange",
  }));
  for (const mention of sourceText.matchAll(connectorMentionPattern)) {
    if (!tokens.some((token) => token.text === mention[0])) {
      tokens.push({
        description: "Reconnect or replace this mention",
        id: mention[0],
        label: "Unavailable account",
        text: mention[0],
        tone: "orange",
      });
    }
  }
  const hasUnavailableMentions = tokens.some(
    (token) => token.tone === "orange" && sourceText.includes(token.text)
  );
  let statusLabel = "Not activated";
  if (data.active) {
    statusLabel = data.setting.enabled ? "Active" : "Paused";
  }
  if (data.setting.enabled && !data.canRun) {
    statusLabel = "Needs attention";
  }
  let activationLabel = "Activate action";
  if (isCurrentActive) {
    activationLabel = data.setting.enabled ? "Activated" : "Resume action";
  }

  return (
    <div className="space-y-4">
      {view === "overview" && data.active ? (
        <SettingsCard>
          <SettingsRow
            action={
              <Pill tone={data.canRun ? "success" : "neutral"}>
                {statusLabel}
              </Pill>
            }
            title="Your action"
          >
            {data.active.specification.review.summary}
          </SettingsRow>
          <div className={settingsSurfaceVariants({ variant: "body" })}>
            <p className="text-body-sm text-muted-fg">
              {getActionsTriggerLabel(data.active.specification.trigger)}
            </p>
            {data.active.specification.connectors.length > 0 ? (
              <SettingsRowText title="Your connected accounts">
                <ul className="space-y-1">
                  {data.active.specification.connectors.map((connector) => (
                    <li className="break-words" key={connector.referenceId}>
                      {data.accounts.find(
                        (account) =>
                          account.connectionId === connector.connectionId
                      )?.label ?? "Unavailable account"}
                    </li>
                  ))}
                </ul>
              </SettingsRowText>
            ) : null}
            <details className="text-body-sm text-muted-fg">
              <summary className="cursor-pointer">Current instructions</summary>
              <p className="mt-2 whitespace-pre-wrap text-fg">
                {data.active.specification.instructions}
              </p>
            </details>
            {data.runBlockedReason && data.setting.enabled ? (
              <p className="text-caption text-warning">
                {data.runBlockedReason}
              </p>
            ) : null}
            {data.active.blockingReasons.length > 0 && !data.setting.enabled ? (
              <p className="text-caption text-warning">
                {data.active.blockingReasons[0]}
              </p>
            ) : null}
            <ActionFooter>
              <Button
                disabled={
                  pending || (!data.setting.enabled && !data.active.canActivate)
                }
                onClick={() => {
                  if (data.setting.enabled) {
                    pause.mutate({ mailboxId, version: data.setting.version });
                  } else if (data.active) {
                    activate.mutate({
                      acknowledgeAssumptions: true,
                      mailboxId,
                      revisionId: data.active.id,
                      version: data.setting.version,
                    });
                  }
                }}
                pending={pause.isPending || activate.isPending}
                pendingLabel={data.setting.enabled ? "Pausing…" : "Resuming…"}
                size="sm"
                type="button"
                variant="secondary"
              >
                {data.setting.enabled ? "Pause action" : "Resume action"}
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setView("editing");
                }}
                size="sm"
                type="button"
              >
                {data.draft && data.draft.id !== data.active.id
                  ? "Continue editing"
                  : "Edit action"}
              </Button>
            </ActionFooter>
          </div>
        </SettingsCard>
      ) : null}
      {view === "overview" &&
      data.active &&
      data.active.specification.connectors.length > 0 ? (
        <p className="text-caption text-muted-fg">
          Destination access follows the permissions of your connected app.
        </p>
      ) : null}

      {data.legacyActions.length > 0 ? (
        <SettingsCard>
          <div className={settingsSurfaceVariants({ variant: "body" })}>
            <p className="text-body-sm text-fg">Earlier actions need review</p>
            <p className="text-body-sm text-muted-fg">
              Earlier actions are inactive. Describe the behavior you want in
              the instructions below, then review and activate it.
            </p>
            <ul className="list-disc space-y-1 pl-4 text-body-sm text-fg">
              {data.legacyActions.map((action) => (
                <li key={action.id}>{action.name}</li>
              ))}
            </ul>
          </div>
        </SettingsCard>
      ) : null}

      {view === "overview" ? null : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (view !== "editing") {
              return;
            }
            review.mutate({
              mailboxId,
              sourceText,
              version: data.setting.version,
            });
          }}
        >
          {data.active && data.setting.enabled ? (
            <p className="text-caption text-muted-fg">
              Your current action keeps running until you activate these changes
              or pause it.
            </p>
          ) : null}
          {view === "editing" ? (
            <div className="space-y-2">
              <p className="text-body-sm font-medium text-fg">Instructions</p>
              <PromptComposerFrame>
                <TokenField
                  aria-label="Action instructions"
                  disabled={pending}
                  emptyMessage="No matching connected accounts"
                  onChange={(value) => {
                    setSourceText(value);
                    setAcknowledgedRevisionId(null);
                  }}
                  placeholder="When new mail arrives, summarize the request and prepare a reply draft. Type @ to choose a connected account."
                  size="prompt"
                  suggestionsLabel="Connected accounts"
                  tokens={tokens}
                  value={sourceText}
                />
              </PromptComposerFrame>
              <p className="text-caption text-muted-fg">
                Type @ to choose one of your exact connected accounts. Sending
                and deleting stay under your control.
              </p>
              {data.canSaveDraft ? null : (
                <p className="text-caption text-muted-fg">
                  You can use mail you can read. Saving reply drafts requires
                  permission to reply in this inbox.
                </p>
              )}
              {hasUnavailableMentions ? (
                <output className="block text-caption text-warning">
                  A mentioned account is unavailable. Reconnect it or replace
                  its mention before activation.
                </output>
              ) : null}
              {sourceText.length > 16_384 ? (
                <p className="text-caption text-destructive" role="alert">
                  Keep instructions under 16,384 characters.
                </p>
              ) : null}
              {reviewed === null && data.draft !== null ? (
                <output className="block text-caption text-muted-fg">
                  Your edits need a new review before activation.
                </output>
              ) : null}
            </div>
          ) : null}

          {reviewed && view === "review" ? (
            <MailboxActionsReview
              accounts={data.accounts}
              revision={reviewed}
              shared={data.shared}
            />
          ) : null}

          {view === "review" &&
          reviewed &&
          reviewed.specification.review.assumptions.length > 0 ? (
            <label
              className="flex items-start gap-2 text-body-sm text-fg"
              htmlFor={acknowledgementId}
            >
              <Checkbox
                checked={acknowledgedRevisionId === reviewed.id}
                disabled={pending}
                id={acknowledgementId}
                onCheckedChange={(checked) => {
                  setAcknowledgedRevisionId(checked ? reviewed.id : null);
                }}
              >
                <CheckboxIndicator />
              </Checkbox>
              I have reviewed and accept the assumptions above.
            </label>
          ) : null}

          <ActionFooter>
            {view === "review" ? (
              <Button
                disabled={pending}
                onClick={() => {
                  setView("editing");
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                Back to edit
              </Button>
            ) : null}
            {view === "editing" && data.active ? (
              <Button
                disabled={pending}
                onClick={() => {
                  setView("overview");
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            ) : null}
            {view === "editing" ? (
              <Button
                disabled={
                  pending ||
                  sourceText.trim().length === 0 ||
                  sourceText.length > 16_384
                }
                pending={review.isPending}
                pendingLabel="Reviewing…"
                size="sm"
                type="submit"
              >
                {reviewed ? "Review again" : "Review instructions"}
              </Button>
            ) : null}
            {reviewed && view === "review" ? (
              <Button
                disabled={pending || !canActivate}
                onClick={() => {
                  activate.mutate({
                    acknowledgeAssumptions:
                      acknowledgedRevisionId === reviewed.id,
                    mailboxId,
                    revisionId: reviewed.id,
                    version: data.setting.version,
                  });
                }}
                pending={activate.isPending}
                pendingLabel="Activating…"
                size="sm"
                type="button"
              >
                {activationLabel}
              </Button>
            ) : null}
          </ActionFooter>
        </form>
      )}
    </div>
  );
};

export const MailboxActionsSettings = ({
  mailboxId,
}: {
  mailboxId: string;
}) => {
  const queryClient = useQueryClient();
  const queryOptions = orpc.mailAgent.get.queryOptions({
    input: { mailboxId },
  });
  const query = useQuery(queryOptions);

  return (
    <SettingsSection
      description="Only you can see these instructions, connected accounts, and results."
      title="Your action"
    >
      {query.isPending ? (
        <SettingsLoadingState label="Loading actions" />
      ) : null}
      {query.isError && query.data === undefined ? (
        <SettingsErrorState
          message="Could not load actions."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {query.data ? (
        <MailboxActionsForm
          data={query.data}
          key={mailboxId}
          mailboxId={mailboxId}
          onUpdate={(data) => {
            queryClient.setQueryData(queryOptions.queryKey, data);
            void queryClient.invalidateQueries({
              queryKey: orpc.mailAgent.threadResults.key({
                input: { mailboxId },
              }),
            });
          }}
        />
      ) : null}
    </SettingsSection>
  );
};
