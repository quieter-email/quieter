"use client";

import type { RouterOutputs } from "@quieter/orpc";
import {
  Airplane01Icon,
  Calendar03Icon,
  Cancel01Icon,
  Copy01Icon,
  DeliveryTracking01Icon,
  DocumentValidationIcon,
  Invoice01Icon,
  Key01Icon,
  SecurityWarningIcon,
  Task01Icon,
  Ticket01Icon,
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
type UsefulDetailKind = UsefulDetail["kind"];

const kindLabels = {
  application: "Application",
  appointment: "Appointment",
  bill: "Bill or renewal",
  delivery: "Delivery",
  document_expiry: "Expiring document",
  reservation: "Reservation",
  return: "Return or refund",
  security_alert: "Security alert",
  task: "Task",
  travel: "Travel",
  verification_code: "Verification code",
} as const satisfies Record<UsefulDetailKind, string>;

const kindIcons = {
  application: DocumentValidationIcon,
  appointment: Calendar03Icon,
  bill: Invoice01Icon,
  delivery: DeliveryTracking01Icon,
  document_expiry: DocumentValidationIcon,
  reservation: Ticket01Icon,
  return: DeliveryTracking01Icon,
  security_alert: SecurityWarningIcon,
  task: Task01Icon,
  travel: Airplane01Icon,
  verification_code: Key01Icon,
} as const satisfies Record<UsefulDetailKind, typeof Key01Icon>;

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

const eventDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const copyText = async (value: string, successMessage: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Could not copy.");
  }
};

const getDetailMetadata = (detail: UsefulDetail, now: number) => {
  if (detail.kind === "verification_code") {
    const minutesRemaining = Math.max(
      1,
      Math.ceil((new Date(detail.expiresAt).getTime() - now) / (1000 * 60)),
    );
    return `Expires in ${minutesRemaining} min`;
  }

  const parts = [
    detail.kind === "delivery" && detail.status ? deliveryStatusLabels[detail.status] : null,
    detail.eventAt ? eventDateFormatter.format(new Date(detail.eventAt)) : null,
    detail.location,
    detail.reference ? `Ref ${detail.reference}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
};

const UsefulDetailCard = ({
  detail,
  now,
  onDismiss,
  onOpen,
}: {
  detail: UsefulDetail;
  now: number;
  onDismiss: () => void;
  onOpen: () => void;
}) => {
  const icon = kindIcons[detail.kind];
  const verificationCode = detail.kind === "verification_code" ? detail.code : null;
  const copyValue =
    detail.kind === "verification_code"
      ? verificationCode
      : (detail.trackingNumber ?? detail.reference);
  const copyLabel =
    detail.kind === "verification_code"
      ? "Copy code"
      : detail.trackingNumber
        ? "Copy tracking number"
        : "Copy reference";

  return (
    <article
      className={cn(
        "relative flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 shadow-sm",
        {
          "border-border/70 bg-muted/55": detail.kind !== "security_alert",
          "border-destructive/25 bg-destructive/8": detail.kind === "security_alert",
        },
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={onOpen}
        type="button"
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md bg-background/70 text-muted-foreground",
            {
              "text-destructive": detail.kind === "security_alert",
              "text-foreground":
                detail.kind === "delivery" &&
                (detail.status === "out_for_delivery" || detail.status === "ready_for_pickup"),
            },
          )}
        >
          <HugeiconsIcon aria-hidden className="size-4" icon={icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">{detail.title}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {kindLabels[detail.kind]}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {[getDetailMetadata(detail, now), detail.summary].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>

      {verificationCode ? (
        <button
          className="rounded-md px-2 py-1 font-mono text-base font-semibold tracking-[0.12em] text-foreground outline-none hover:bg-background/80 focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={() => void copyText(verificationCode, "Code copied.")}
          title="Copy code"
          type="button"
        >
          {verificationCode}
        </button>
      ) : (
        copyValue && (
          <IconButtonTooltip label={copyLabel}>
            <button
              aria-label={copyLabel}
              className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
              onClick={() => void copyText(copyValue, "Copied.")}
              type="button"
            >
              <HugeiconsIcon aria-hidden className="size-3.5" icon={Copy01Icon} />
            </button>
          </IconButtonTooltip>
        )
      )}

      <IconButtonTooltip label="Dismiss">
        <button
          aria-label={`Dismiss ${kindLabels[detail.kind].toLowerCase()}`}
          className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
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
            <UsefulDetailCard
              detail={detail}
              now={now}
              onDismiss={() => dismissMutation.mutate({ id: detail.id, mailboxId })}
              onOpen={() => onActivateMessage(detail.gmailMessageId)}
            />
          </div>
        ))}
      </div>
    </section>
  );
};
