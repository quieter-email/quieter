"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { cn, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { GmailUsefulDetailCard } from "~/features/gmail-useful-details/components/gmail-useful-detail-card";
import {
  getGmailUsefulDetailsQueryKey,
  gmailUsefulDetailsQueryOptions,
} from "~/lib/gmail/useful-details-query";
import { orpc } from "~/lib/orpc";

type UsefulDetailsData = RouterOutputs["mail"]["listGmailUsefulDetails"];

export const GmailUsefulDetails = ({
  mailboxId,
  onActivateMessage,
}: {
  mailboxId: string;
  onActivateMessage: (messageId: string) => void;
}) => {
  const queryClient = useQueryClient();
  const queryKey = getGmailUsefulDetailsQueryKey(mailboxId);
  const { data: detailsData } = useQuery(gmailUsefulDetailsQueryOptions(mailboxId));
  const [now, setNow] = useState(() => Date.now());
  const dismissMutation = useMutation({
    ...orpc.mail.dismissGmailUsefulDetail.mutationOptions(),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<UsefulDetailsData>(queryKey);
      queryClient.setQueryData<UsefulDetailsData>(queryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== id),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error("Could not dismiss this update.");
    },
  });

  const items = detailsData?.items ?? [];
  const hasExpiringCode = items.some((item) => item.kind === "verification_code");

  useEffect(() => {
    if (!hasExpiringCode) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000 * 15);
    return () => window.clearInterval(timer);
  }, [hasExpiringCode]);

  useEffect(() => {
    if (!detailsData?.nextRelevantAt) return;
    const delay = new Date(detailsData.nextRelevantAt).getTime() - Date.now();
    if (delay <= 0) {
      void queryClient.invalidateQueries({ queryKey: getGmailUsefulDetailsQueryKey(mailboxId) });
      return;
    }

    const timer = window.setTimeout(
      () =>
        void queryClient.invalidateQueries({
          queryKey: getGmailUsefulDetailsQueryKey(mailboxId),
        }),
      Math.min(delay, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [detailsData?.nextRelevantAt, mailboxId, queryClient]);

  const visibleItems = items.filter((item) => new Date(item.expiresAt).getTime() > now);
  if (!detailsData?.enabled || visibleItems.length === 0) {
    return null;
  }

  const hasStack = visibleItems.length > 1;

  return (
    <section aria-label="Timely mail updates" className="px-3 pt-1.5 pb-2">
      <div className="relative flex flex-col gap-1.5">
        {hasStack && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-2 top-2 bottom-0 -z-20 rounded-lg border border-border/35 bg-muted/20 shadow-sm"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-1 top-1 bottom-0 -z-10 rounded-lg border border-border/45 bg-muted/30 shadow-sm"
            />
          </>
        )}
        {visibleItems.map((detail, index) => (
          <div
            className={cn("relative", {
              "z-10": hasStack && index === 0,
            })}
            key={detail.id}
          >
            <GmailUsefulDetailCard
              detail={detail}
              onDismiss={() => dismissMutation.mutate({ id: detail.id, mailboxId })}
              onOpen={() => onActivateMessage(detail.gmailMessageId)}
            />
          </div>
        ))}
      </div>
    </section>
  );
};
