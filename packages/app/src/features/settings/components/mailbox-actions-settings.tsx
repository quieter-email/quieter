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
      onUpdate(updated);
    },
  });
  const activate = useMutation({
    ...orpc.mailAgent.activate.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "mailbox-actions-activate" });
    },
    onSuccess: onUpdate,
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
  let activationLabel = "Activate action";
  if (isCurrentActive) {
    activationLabel = data.setting.enabled ? "Activated" : "Resume action";
  }

  return (
    <div className="space-y-4">
      <SettingsCard>
        <SettingsRow
          action={
            <Pill tone={data.setting.enabled ? "success" : "neutral"}>
              {statusLabel}
            </Pill>
          }
          title="Mailbox action"
        >
          {data.active
            ? data.active.specification.review.summary
            : "Describe what you want done, then review it before activation."}
        </SettingsRow>
        {data.active ? (
          <div className={settingsSurfaceVariants({ variant: "body" })}>
            <p className="text-body-sm text-muted-fg">
              {getActionsTriggerLabel(data.active.specification.trigger)}
            </p>
            {data.setting.enabled && (!isCurrentActive || reviewed === null) ? (
              <p className="text-caption text-muted-fg">
                The current action keeps running until you activate a
                replacement or pause it.
              </p>
            ) : null}
            <details className="text-body-sm text-muted-fg">
              <summary className="cursor-pointer">Current instructions</summary>
              <p className="mt-2 whitespace-pre-wrap text-fg">
                {data.active.specification.instructions}
              </p>
            </details>
            {data.canManage && data.setting.enabled ? (
              <ActionFooter>
                <Button
                  disabled={pending}
                  onClick={() => {
                    pause.mutate({
                      mailboxId,
                      version: data.setting.version,
                    });
                  }}
                  pending={pause.isPending}
                  pendingLabel="Pausing…"
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Pause action
                </Button>
              </ActionFooter>
            ) : null}
          </div>
        ) : null}
      </SettingsCard>

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

      {data.canManage ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            review.mutate({
              mailboxId,
              sourceText,
              version: data.setting.version,
            });
          }}
        >
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
              Type @ to choose an exact account. Sending and deleting stay under
              your control. Prepared replies open as drafts for review.
            </p>
            {hasUnavailableMentions ? (
              <output className="block text-caption text-warning">
                A mentioned account is unavailable. Reconnect it or replace its
                mention before activation.
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

          {reviewed ? (
            <MailboxActionsReview
              accounts={data.accounts}
              revision={reviewed}
            />
          ) : null}

          {reviewed && reviewed.specification.review.assumptions.length > 0 ? (
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
              variant={reviewed ? "secondary" : "default"}
            >
              {reviewed ? "Review again" : "Review instructions"}
            </Button>
            {reviewed ? (
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
      ) : (
        <p className="text-body-sm text-muted-fg">
          A mailbox manager can review, activate, or pause this action.
        </p>
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
      description="Tell Quieter what to do with mail in this mailbox. Review the instructions and account access before turning it on."
      title="Actions"
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
          }}
        />
      ) : null}
    </SettingsSection>
  );
};
