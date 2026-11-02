"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query-keys";
import { orpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { Button, LinkButton } from "@quieter/ui/button";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";
import {
  SettingsCard,
  settingsSurfaceVariants,
} from "@quieter/ui/settings-layout";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type ActionRun = RouterOutputs["mailAgent"]["threadResults"]["runs"][number];

const runStatus = {
  needs_attention: {
    label: "Needs attention",
    summary: "The action stopped. Review its results before running it again.",
    tone: "orange",
  },
  queued: {
    label: "Waiting",
    summary: "The action is waiting to start.",
    tone: "neutral",
  },
  running: {
    label: "Working",
    summary: "The action is working on this thread.",
    tone: "purple",
  },
  skipped: {
    label: "Skipped",
    summary: "No action was needed for this thread.",
    tone: "neutral",
  },
  succeeded: {
    label: "Completed",
    summary: "The action completed.",
    tone: "success",
  },
} satisfies Record<
  ActionRun["status"],
  { label: string; summary: string; tone: PillTone }
>;

export const ThreadActionResults = ({
  mailboxId,
  onOpenDraft,
  threadId,
  threadMessages,
}: {
  mailboxId: string;
  onOpenDraft?: (message: MessageListItem) => void;
  threadId: string;
  threadMessages: MessageListItem[];
}) => {
  const queryClient = useQueryClient();
  const [invocationId, setInvocationId] = useState(() => crypto.randomUUID());
  const options = orpc.mailAgent.threadResults.queryOptions({
    input: { mailboxId, threadId },
  });
  const query = useQuery({
    ...options,
    refetchInterval: (current) =>
      current.state.data?.runs.some(
        (run) => run.status === "queued" || run.status === "running"
      ) === true
        ? 2500
        : false,
    refetchIntervalInBackground: false,
  });
  const run = useMutation({
    ...orpc.mailAgent.run.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "thread-action-run" });
    },
    onSuccess: async () => {
      setInvocationId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
  });
  const completedRuns = query.data?.runs
    .filter((entry) => entry.status !== "queued" && entry.status !== "running")
    .map((entry) => `${entry.id}:${entry.status}:${entry.draftId ?? ""}`)
    .join("|");

  useEffect(() => {
    if (completedRuns) {
      void queryClient.invalidateQueries({
        queryKey: getThreadQueryKey(mailboxId, threadId),
      });
    }
  }, [completedRuns, mailboxId, queryClient, threadId]);

  if (query.isError && query.data === undefined) {
    return (
      <section aria-label="Thread actions" className="m-3 @sm:mx-5 @sm:my-4">
        <SettingsCard variant="error">
          <p className="text-body-sm text-fg" role="alert">
            Could not load actions for this thread.
          </p>
          <Button
            onClick={() => {
              void query.refetch();
            }}
            size="sm"
            type="button"
          >
            Try again
          </Button>
        </SettingsCard>
      </section>
    );
  }

  if (
    !query.data ||
    (!query.data.canRun &&
      !query.data.hasPrivateResults &&
      query.data.runs.length === 0)
  ) {
    return null;
  }
  const pending = query.data.runs.some(
    (entry) => entry.status === "queued" || entry.status === "running"
  );

  return (
    <section aria-label="Thread actions" className="m-3 @sm:mx-5 @sm:my-4">
      <SettingsCard>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-body-sm font-medium text-fg">Actions</h2>
            <Button
              disabled={!query.data.canRun || run.isPending || pending}
              onClick={() => {
                run.mutate({
                  invocationId,
                  mailboxId,
                  threadId,
                });
              }}
              pending={run.isPending}
              pendingLabel="Starting…"
              size="sm"
              type="button"
            >
              Run action
            </Button>
          </div>
          {query.data.hasPrivateResults ? (
            <p className="text-caption text-muted-fg">
              Some results are private to the person whose connected accounts
              were used.
            </p>
          ) : null}
          {query.data.canRun ? null : (
            <p className="text-caption text-muted-fg">
              Running is unavailable. A mailbox manager can review whether this
              action is active and has the required account access.
            </p>
          )}
          {query.data.runs.length === 0 && !query.data.hasPrivateResults ? (
            <p className="text-body-sm text-muted-fg">
              Run the active mailbox instructions on this thread. Results appear
              here, and prepared replies stay in drafts for review.
            </p>
          ) : null}
          <div aria-live="polite" className="space-y-4">
            {query.data.runs.map((entry) => {
              const status = runStatus[entry.status];
              const draftMessage = entry.draftId
                ? threadMessages.find(
                    (message) => message.draftId === entry.draftId
                  )
                : undefined;
              return (
                <article className="space-y-2" key={entry.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={status.tone}>{status.label}</Pill>
                    <time
                      className="text-caption text-muted-fg"
                      dateTime={entry.createdAt.toISOString()}
                    >
                      {entry.createdAt.toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </div>
                  <p className="text-body-sm whitespace-pre-wrap text-fg">
                    {entry.summary || status.summary}
                  </p>
                  {entry.errorMessage ? (
                    <p className="text-body-sm text-warning">
                      {entry.errorMessage}
                    </p>
                  ) : null}
                  {entry.effects.length > 0 ? (
                    <ul className="space-y-2">
                      {entry.effects.map((effect) => (
                        <li className="space-y-1" key={effect.id}>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-body-sm text-fg">
                              {effect.label}
                            </p>
                            <Pill
                              tone={
                                effect.status === "completed"
                                  ? "success"
                                  : "orange"
                              }
                            >
                              {effect.status === "completed"
                                ? "Confirmed"
                                : "Check before retrying"}
                            </Pill>
                            {effect.url ? (
                              <LinkButton
                                rel="noreferrer"
                                size="sm"
                                target="_blank"
                                to={effect.url}
                                variant="secondary"
                              >
                                Open result
                              </LinkButton>
                            ) : null}
                          </div>
                          {effect.title ? (
                            <p className="text-body-sm text-muted-fg">
                              {effect.title}
                            </p>
                          ) : null}
                          {effect.externalId &&
                          effect.externalId !== entry.draftId ? (
                            <p className="text-caption break-all text-muted-fg">
                              Reference {effect.externalId}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.draftId ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-caption text-muted-fg">
                        A reply draft was prepared. Review it before sending.
                      </p>
                      {onOpenDraft && draftMessage ? (
                        <Button
                          onClick={() => {
                            onOpenDraft(draftMessage);
                          }}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Open draft
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </SettingsCard>
    </section>
  );
};
