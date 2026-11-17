import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { controlMutationIdSchema } from "@quieter/orpc/control/mutation-contracts";
import type { ControlMutationReview } from "@quieter/orpc/control/mutation-contracts";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button, LinkButton } from "@quieter/ui/button";
import {
  SettingsCard,
  SettingsFieldRow,
  SettingsInsetRow,
  SettingsPageHeader,
  settingsSurfaceVariants,
} from "@quieter/ui/settings-layout";
import { Text } from "@quieter/ui/text";
import * as Sentry from "@sentry/react";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  ControlReviewRequestError,
  requestControlReview,
} from "#/lib/control-review-client";

const reviewStates = {
  approved: {
    description:
      "You approved this request. The requester may now apply the exact changes below before approval expires. No settings have been applied by this review page.",
    title: "Approved, awaiting execution",
  },
  cancelled: {
    description:
      "This request was cancelled. It can no longer change your team settings.",
    title: "Change cancelled",
  },
  expired: {
    description:
      "This request expired. Ask the requester to prepare a new change if you still want it.",
    title: "Change expired",
  },
  failed: {
    description:
      "This request did not complete. Review the outcome before asking for a new change.",
    title: "Change failed",
  },
  prepared: {
    description:
      "Review the requested settings for this team. Approval allows the requester to apply this exact change before it expires. Approving here does not apply it.",
    title: "Awaiting your approval",
  },
  succeeded: {
    description: "The requester applied this change successfully.",
    title: "Change applied",
  },
} satisfies Record<
  ControlMutationReview["status"],
  { description: string; title: string }
>;

const ControlReviewDetails = ({
  busy,
  onAction,
  onRefresh,
  pendingAction,
  review,
}: {
  busy: boolean;
  onAction: (action: "approve" | "cancel") => void;
  onRefresh: () => void;
  pendingAction: "approve" | "cancel" | undefined;
  review: ControlMutationReview;
}) => {
  const state = reviewStates[review.status];
  const pending = review.status === "prepared" || review.status === "approved";
  return (
    <>
      <SettingsCard>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <Text as="h2" size="sm" weight="medium">
            {state.title}
          </Text>
          <Text size="sm" tone="muted">
            {state.description}
          </Text>
        </div>
        <SettingsFieldRow
          action={<Text size="sm">{review.organizationName}</Text>}
          label="Team"
          value="This request applies only to this team."
        />
        <SettingsFieldRow
          action={
            <Text size="sm">
              <time dateTime={review.expiresAt}>
                {new Date(review.expiresAt).toLocaleString()}
              </time>
            </Text>
          }
          label={pending ? "Approval expires" : "Approval expiry"}
          value="The requester must execute an approved change before this time."
        />
      </SettingsCard>
      <SettingsCard>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <Text as="h2" size="sm" weight="medium">
            Requested changes
          </Text>
          <Text size="sm" tone="muted">
            Only the settings listed below are part of this request.
          </Text>
        </div>
        {review.patch.openTrackingEnabled === undefined ? null : (
          <SettingsFieldRow
            action={
              <Text size="sm">
                {review.patch.openTrackingEnabled ? "Enabled" : "Disabled"}
              </Text>
            }
            label="Open tracking"
            value="Track opens for outgoing messages."
          />
        )}
        {review.patch.allowPerSendOverride === undefined ? null : (
          <SettingsFieldRow
            action={
              <Text size="sm">
                {review.patch.allowPerSendOverride ? "Allowed" : "Not allowed"}
              </Text>
            }
            label="Per-message overrides"
            value="Allow open tracking to be changed for an individual message."
          />
        )}
        {review.status === "succeeded" ? (
          <div className={settingsSurfaceVariants({ variant: "body" })}>
            <Text as="h2" size="sm" weight="medium">
              Settings after this change
            </Text>
            <Text size="sm" tone="muted">
              Open tracking was{" "}
              {review.result.openTrackingEnabled ? "enabled" : "disabled"}.
              Per-message overrides were{" "}
              {review.result.allowPerSendOverride ? "allowed" : "not allowed"}.
            </Text>
          </div>
        ) : null}
        {review.status === "failed" ? (
          <div className={settingsSurfaceVariants({ variant: "body" })}>
            <Text size="sm" tone="destructive">
              {review.error.message}
            </Text>
          </div>
        ) : null}
        <SettingsInsetRow>
          <ActionFooter>
            {pending ? (
              <Button
                disabled={busy}
                onClick={() => {
                  onAction("cancel");
                }}
                pending={pendingAction === "cancel"}
                pendingLabel="Cancelling"
                variant="secondary"
              >
                Cancel change
              </Button>
            ) : null}
            {review.status === "prepared" ? (
              <Button
                disabled={busy}
                onClick={() => {
                  onAction("approve");
                }}
                pending={pendingAction === "approve"}
                pendingLabel="Approving"
              >
                Approve change
              </Button>
            ) : null}
            {review.status === "approved" ? (
              <Button disabled={busy} onClick={onRefresh}>
                Refresh status
              </Button>
            ) : null}
            {pending ? null : <LinkButton to="/">Open Quieter</LinkButton>}
          </ActionFooter>
        </SettingsInsetRow>
      </SettingsCard>
    </>
  );
};

const ControlReviewContent = ({ approvalId }: { approvalId: string }) => {
  const session = authClient.useSession();
  const client = useQueryClient();
  const userId = session.data?.user.id;
  const sessionId = session.data?.session.id;
  const validId = controlMutationIdSchema.safeParse(approvalId).success;
  const queryKey = ["control-mutation-review", userId, sessionId, approvalId];
  const review = useQuery({
    enabled: userId !== undefined && sessionId !== undefined && validId,
    gcTime: 0,
    queryFn: async ({ signal }) =>
      await requestControlReview({ action: "review", id: approvalId, signal }),
    queryKey,
    refetchInterval: (query) =>
      query.state.data?.status === "prepared" ||
      query.state.data?.status === "approved"
        ? 30_000
        : false,
    retry: false,
    staleTime: 0,
  });
  const action = useMutation({
    mutationFn: async (input: {
      action: "approve" | "cancel";
      approvalId: string;
      sessionId: string;
      userId: string;
    }) =>
      await requestControlReview({
        action: input.action,
        id: input.approvalId,
      }),
    onError: (error, input) => {
      toastError(error, { boundary: "control-review" });
      void client.invalidateQueries({
        queryKey: [
          "control-mutation-review",
          input.userId,
          input.sessionId,
          input.approvalId,
        ],
      });
    },
    onSuccess: (result, input) => {
      client.setQueryData(
        [
          "control-mutation-review",
          input.userId,
          input.sessionId,
          input.approvalId,
        ],
        result
      );
    },
  });
  const authRequired =
    !session.isPending &&
    (session.data === null ||
      (review.error instanceof ControlReviewRequestError &&
        review.error.status === 401));
  const unavailable =
    !validId ||
    (review.error instanceof ControlReviewRequestError &&
      (review.error.status === 403 || review.error.status === 404));

  let content: ReactNode;
  if (session.isPending) {
    content = (
      <Text aria-live="polite" size="sm" tone="muted">
        Checking your sign-in.
      </Text>
    );
  } else if (authRequired) {
    content = (
      <SettingsCard>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <Text size="sm">Sign in to review this change.</Text>
          <Text size="sm" tone="muted">
            Changes belong to the sign-in that requested them. If that sign-in
            expired, ask the requester to prepare a new change.
          </Text>
          <ActionFooter>
            <LinkButton
              search={{
                returnTo: `/control/review?approvalId=${encodeURIComponent(approvalId)}`,
              }}
              to="/auth"
            >
              Sign in
            </LinkButton>
          </ActionFooter>
        </div>
      </SettingsCard>
    );
  } else if (unavailable) {
    content = (
      <SettingsCard>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <Text size="sm">
            This change is unavailable for your current sign-in or team access.
          </Text>
          <Text size="sm" tone="muted">
            Use the original sign-in that requested it, or ask for a new
            request.
          </Text>
          <ActionFooter>
            <LinkButton to="/">Open Quieter</LinkButton>
          </ActionFooter>
        </div>
      </SettingsCard>
    );
  } else if (review.isError || session.error !== null) {
    content = (
      <SettingsCard>
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <Text size="sm">
            The change could not be loaded. Please try again.
          </Text>
          <ActionFooter>
            <Button
              onClick={() => {
                void session.refetch();
                void review.refetch();
              }}
            >
              Try again
            </Button>
          </ActionFooter>
        </div>
      </SettingsCard>
    );
  } else if (review.data === undefined) {
    content = (
      <Text aria-live="polite" size="sm" tone="muted">
        Loading the requested change.
      </Text>
    );
  } else {
    content = (
      <ControlReviewDetails
        busy={action.isPending || review.isFetching}
        onAction={(selected) => {
          if (userId !== undefined && sessionId !== undefined) {
            action.mutate({ action: selected, approvalId, sessionId, userId });
          }
        }}
        onRefresh={() => {
          void review.refetch();
        }}
        pendingAction={action.isPending ? action.variables.action : undefined}
        review={review.data}
      />
    );
  }
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className={settingsSurfaceVariants({ variant: "page" })}>
        <SettingsPageHeader title="Review team settings change">
          Confirm the exact change you want to allow.
        </SettingsPageHeader>
        {content}
      </div>
    </main>
  );
};

export const ControlReviewPage = ({ approvalId }: { approvalId: string }) => {
  // oxlint-disable-next-line react/hook-use-state -- The page owns one isolated query cache for its lifetime.
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (!(error instanceof ControlReviewRequestError)) {
              Sentry.captureException(
                new Error("Management review could not be loaded.")
              );
            }
          },
        }),
      })
  );
  return (
    <QueryClientProvider client={client}>
      <ControlReviewContent approvalId={approvalId} />
    </QueryClientProvider>
  );
};
