"use client";

import type { RouterOutputs } from "@quieter/orpc";
import {
  Cancel01Icon,
  Copy01Icon,
  DeliveryTracking01Icon,
  Key01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { IconButtonTooltip, cn, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getGmailUsefulDetailsQueryKey,
  gmailUsefulDetailsQueryOptions,
} from "~/lib/gmail/useful-details-query";
import { orpc } from "~/lib/orpc";

type UsefulDetailsData = RouterOutputs["mail"]["listGmailUsefulDetails"];
type UsefulDetail = UsefulDetailsData["items"][number];

const deliveryStatusLabels = {
  delayed: "Delayed",
  delivered: "Delivered",
  in_transit: "In transit",
  ordered: "Order confirmed",
  out_for_delivery: "Out for delivery",
  ready_for_pickup: "Ready for pickup",
  shipped: "Shipped",
  unknown: "Delivery update",
} as const;

const expectedDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

const formatExpectedDate = (value: Date | string | null) => {
  if (!value) return null;
  return expectedDateFormatter.format(new Date(value));
};

const copyText = async (value: string, successMessage: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Could not copy.");
  }
};

const VerificationCodeCard = ({
  detail,
  now,
  onDismiss,
  onOpen,
}: {
  detail: Extract<UsefulDetail, { kind: "verification_code" }>;
  now: number;
  onDismiss: () => void;
  onOpen: () => void;
}) => {
  const minutesRemaining = Math.max(
    1,
    Math.ceil((new Date(detail.expiresAt).getTime() - now) / (1000 * 60)),
  );

  return (
    <article className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-muted/35 p-2.5">
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={onOpen}
        type="button"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-xs">
          <HugeiconsIcon aria-hidden className="size-4" icon={Key01Icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{detail.title}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Expires in {minutesRemaining} min
          </span>
        </span>
      </button>
      <button
        className="rounded-md px-2 py-1 font-mono text-base font-semibold tracking-[0.12em] text-foreground outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={() => void copyText(detail.code, "Code copied.")}
        title="Copy code"
        type="button"
      >
        {detail.code}
      </button>
      <IconButtonTooltip label="Dismiss">
        <button
          aria-label="Dismiss verification code"
          className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={onDismiss}
          type="button"
        >
          <HugeiconsIcon aria-hidden className="size-3.5" icon={Cancel01Icon} />
        </button>
      </IconButtonTooltip>
    </article>
  );
};

const DeliveryCard = ({
  detail,
  onDismiss,
  onOpen,
}: {
  detail: Extract<UsefulDetail, { kind: "delivery" }>;
  onDismiss: () => void;
  onOpen: () => void;
}) => {
  const expectedDate = formatExpectedDate(detail.expectedAt);
  const trackingNumber = detail.trackingNumber;
  const supportingText =
    detail.summary ??
    (expectedDate ? `Expected ${expectedDate}` : (detail.carrier ?? detail.trackingNumber));

  return (
    <article className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-muted/35 p-2.5">
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={onOpen}
        type="button"
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-xs",
            {
              "text-foreground":
                detail.status === "out_for_delivery" || detail.status === "ready_for_pickup",
            },
          )}
        >
          <HugeiconsIcon aria-hidden className="size-4" icon={DeliveryTracking01Icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">{detail.title}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {deliveryStatusLabels[detail.status]}
            </span>
          </span>
          {supportingText && (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {supportingText}
            </span>
          )}
        </span>
      </button>
      {trackingNumber && (
        <IconButtonTooltip label="Copy tracking number">
          <button
            aria-label="Copy tracking number"
            className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={() => void copyText(trackingNumber, "Tracking number copied.")}
            type="button"
          >
            <HugeiconsIcon aria-hidden className="size-3.5" icon={Copy01Icon} />
          </button>
        </IconButtonTooltip>
      )}
      <IconButtonTooltip label="Dismiss">
        <button
          aria-label="Dismiss delivery update"
          className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={onDismiss}
          type="button"
        >
          <HugeiconsIcon aria-hidden className="size-3.5" icon={Cancel01Icon} />
        </button>
      </IconButtonTooltip>
    </article>
  );
};

export const GmailUsefulDetails = ({
  mailboxId,
  onActivateMessage,
}: {
  mailboxId: string;
  onActivateMessage: (messageId: string) => void;
}) => {
  const queryClient = useQueryClient();
  const { data: detailsData } = useQuery(gmailUsefulDetailsQueryOptions(mailboxId));
  const [now, setNow] = useState(() => Date.now());
  const dismissMutation = useMutation({
    ...orpc.mail.dismissGmailUsefulDetail.mutationOptions(),
    onMutate: async ({ id }) => {
      const queryKey = getGmailUsefulDetailsQueryKey(mailboxId);
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
        queryClient.setQueryData(getGmailUsefulDetailsQueryKey(mailboxId), context.previous);
      }
      toast.error("Could not dismiss this detail.");
    },
  });

  const items = detailsData?.items ?? [];
  const hasExpiringCode = items.some((item) => item.kind === "verification_code");

  useEffect(() => {
    if (!hasExpiringCode) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000 * 15);
    return () => window.clearInterval(timer);
  }, [hasExpiringCode]);

  const visibleItems = items.filter((item) => new Date(item.expiresAt).getTime() > now);
  if (!detailsData?.enabled || visibleItems.length === 0) {
    return null;
  }

  return (
    <section aria-label="Ready for you" className="border-b border-border/60 px-3 py-2">
      <p className="mb-1.5 px-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Ready for you
      </p>
      <div className="grid gap-1.5">
        {visibleItems.map((detail) =>
          detail.kind === "verification_code" ? (
            <VerificationCodeCard
              detail={detail}
              key={detail.id}
              now={now}
              onDismiss={() => {
                dismissMutation.mutate({ id: detail.id, mailboxId });
              }}
              onOpen={() => onActivateMessage(detail.gmailMessageId)}
            />
          ) : (
            <DeliveryCard
              detail={detail}
              key={detail.id}
              onDismiss={() => {
                dismissMutation.mutate({ id: detail.id, mailboxId });
              }}
              onOpen={() => onActivateMessage(detail.gmailMessageId)}
            />
          ),
        )}
      </div>
    </section>
  );
};
