"use client";

import {
  SettingsCard,
  SettingsErrorState,
  SettingsLoadingState,
  SettingsRow,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type AuthoritySettings = RouterOutputs["mailAgent"]["authority"];

export const MailboxAiAuthoritySettings = ({
  mailboxId,
}: {
  mailboxId: string;
}) => {
  const queryClient = useQueryClient();
  const query = useQuery(
    orpc.mailAgent.authority.queryOptions({ input: { mailboxId } })
  );
  const update = useMutation({
    ...orpc.mailAgent.updateAuthority.mutationOptions(),
    onError: (
      error,
      variables,
      context: { previous: AuthoritySettings | undefined } | undefined
    ) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          orpc.mailAgent.authority.queryKey({
            input: { mailboxId: variables.mailboxId },
          }),
          context.previous
        );
      }
      toastError(error, { boundary: "mailbox-assistant-permissions" });
    },
    onMutate: async (variables) => {
      const queryKey = orpc.mailAgent.authority.queryKey({
        input: { mailboxId: variables.mailboxId },
      });
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AuthoritySettings>(queryKey);
      if (previous !== undefined) {
        queryClient.setQueryData(queryKey, {
          ...previous,
          automationPaused: variables.automationPaused,
          readOnly: variables.readOnly,
        });
      }
      return { previous };
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.mailAgent.authority.key({
          input: { mailboxId: variables.mailboxId },
        }),
      });
    },
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(
        orpc.mailAgent.authority.queryKey({
          input: { mailboxId: variables.mailboxId },
        }),
        updated
      );
      void queryClient.invalidateQueries({
        queryKey: orpc.mailAgent.get.key({
          input: { mailboxId: variables.mailboxId },
        }),
      });
    },
  });
  const { data } = query;

  return (
    <SettingsSection
      description="Applies to assistant activity for everyone using this inbox. Your own mail controls stay available."
      title="Assistant permissions"
    >
      {query.isPending ? (
        <SettingsLoadingState label="Loading assistant permissions" />
      ) : null}
      {query.isError && data === undefined ? (
        <SettingsErrorState
          message="Could not load assistant permissions."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {data ? (
        <>
          <SettingsCard>
            <SettingsRow
              action={
                <Switch
                  aria-label="Read-only assistant"
                  checked={data.readOnly}
                  disabled={!data.canManage}
                  onCheckedChange={(readOnly) => {
                    update.mutate({
                      automationPaused: data.automationPaused,
                      expectedVersion: data.version,
                      mailboxId,
                      readOnly,
                    });
                  }}
                  pending={update.isPending}
                  size="sm"
                >
                  <SwitchThumb />
                </Switch>
              }
              title="Read-only assistant"
            >
              The assistant can read, search, and suggest changes, but cannot
              save drafts, send mail, or make other changes.
            </SettingsRow>
            <SettingsRow
              action={
                <Switch
                  aria-label="Pause automatic actions"
                  checked={data.automationPaused}
                  disabled={!data.canManage}
                  onCheckedChange={(automationPaused) => {
                    update.mutate({
                      automationPaused,
                      expectedVersion: data.version,
                      mailboxId,
                      readOnly: data.readOnly,
                    });
                  }}
                  pending={update.isPending}
                  size="sm"
                >
                  <SwitchThumb />
                </Switch>
              }
              title="Pause automatic actions"
            >
              Pause new assistant work in the background. You can still ask the
              assistant for help. Each feature keeps its own on or off setting.
            </SettingsRow>
          </SettingsCard>
          <p className="text-caption text-muted-fg">
            {data.canManage
              ? "Start a new request after changing permissions. Actions already sent to an app may finish."
              : "A mailbox owner or manager can change these permissions."}
          </p>
        </>
      ) : null}
    </SettingsSection>
  );
};
