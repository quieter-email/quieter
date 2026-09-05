"use client";

import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { GmailUsefulDetailCard } from "#/features/gmail-useful-details/components/gmail-useful-detail-card";
import { toastError } from "#/lib/error-toast";
import {
  getGmailUsefulDetailsQueryKey,
  gmailUsefulDetailsQueryOptions,
} from "#/lib/gmail/useful-details-query";
import { orpc } from "#/lib/orpc";

type UsefulDetailsData = RouterOutputs["mail"]["listGmailUsefulDetails"];

export const GmailUsefulDetails = ({
  mailboxId,
  onActivateMessage,
}: {
  mailboxId: string;
  onActivateMessage: (messageId: string, threadId?: string | null) => void;
}) => {
  const queryClient = useQueryClient();
  const queryKey = getGmailUsefulDetailsQueryKey(mailboxId);
  const { data: detailsData } = useQuery(
    gmailUsefulDetailsQueryOptions(mailboxId)
  );
  const dismissMutationOptions =
    orpc.mail.dismissGmailUsefulDetail.mutationOptions();
  const [now, setNow] = useState(() => Date.now());
  const dismissMutation = useMutation<
    RouterOutputs["mail"]["dismissGmailUsefulDetail"],
    unknown,
    RouterInputs["mail"]["dismissGmailUsefulDetail"],
    { previous: UsefulDetailsData | undefined }
  >({
    mutationFn: dismissMutationOptions.mutationFn,
    mutationKey: dismissMutationOptions.mutationKey,
    onError: (error, _variables, context) => {
      if (context !== null && context !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toastError(error, {
        boundary: "useful-details",
        fallback: "Could not dismiss this update.",
      });
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<UsefulDetailsData>(queryKey);
      queryClient.setQueryData<UsefulDetailsData>(queryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== id),
            }
          : current
      );
      return { previous };
    },
  });

  const items = detailsData?.items ?? [];
  const hasExpiringCode = items.some(
    (item) => item.kind === "verification_code"
  );

  useEffect((): (() => void) | undefined => {
    if (!hasExpiringCode) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000 * 15);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasExpiringCode]);

  useEffect((): (() => void) | undefined => {
    if (!detailsData?.nextRelevantAt) {
      return undefined;
    }
    const delay = new Date(detailsData.nextRelevantAt).getTime() - Date.now();
    if (delay <= 0) {
      void queryClient.invalidateQueries({
        queryKey: getGmailUsefulDetailsQueryKey(mailboxId),
      });
      return undefined;
    }

    const timer = window.setTimeout(
      () =>
        void queryClient.invalidateQueries({
          queryKey: getGmailUsefulDetailsQueryKey(mailboxId),
        }),
      Math.min(delay, 2_147_483_647)
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [detailsData?.nextRelevantAt, mailboxId, queryClient]);

  const visibleItems = items.filter(
    (item) => new Date(item.expiresAt).getTime() > now
  );
  if (detailsData?.enabled !== true || visibleItems.length === 0) {
    return null;
  }

  return (
    <section aria-label="Timely mail updates" className="px-3 pt-2 pb-3">
      <div className="flex flex-col gap-2">
        {visibleItems.map((detail) => (
          <div className="relative" key={detail.id}>
            <GmailUsefulDetailCard
              detail={detail}
              mailboxId={mailboxId}
              onDismiss={() => {
                dismissMutation.mutate({ id: detail.id, mailboxId });
              }}
              onOpen={() => {
                onActivateMessage(detail.gmailMessageId, detail.gmailThreadId);
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
};
