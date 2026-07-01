"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { Cancel01Icon, ThumbsDownIcon, ThumbsUpIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getGmailUsefulDetailsQueryKey } from "~/lib/gmail/useful-details-query";
import { orpc } from "~/lib/orpc";

type UsefulDetailsData = RouterOutputs["mail"]["listGmailUsefulDetails"];
export type GmailUsefulDetail = UsefulDetailsData["items"][number];

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

const summaryFirstKinds = new Set<GmailUsefulDetail["kind"]>([
  "application",
  "appointment",
  "bill",
  "document_expiry",
  "reservation",
  "return",
  "security_alert",
  "task",
  "travel",
]);

const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied.");
  } catch {
    toast.error("Could not copy.");
  }
};

const getDetailMetadata = (detail: GmailUsefulDetail) => {
  if (detail.kind === "verification_code") {
    return detail.code ? [detail.code] : [];
  }

  return [
    detail.kind === "delivery" && detail.status ? deliveryStatusLabels[detail.status] : null,
    detail.eventAt ? eventDateFormatter.format(new Date(detail.eventAt)) : null,
    detail.location,
    detail.reference,
  ].filter((value): value is string => Boolean(value));
};

const getDetailText = (detail: GmailUsefulDetail, metadata: string[]) => {
  if (detail.summary && summaryFirstKinds.has(detail.kind)) {
    return {
      headline: detail.summary,
      kicker: metadata.includes(detail.title) ? null : detail.title,
    };
  }

  return {
    headline: detail.title,
    kicker: detail.summary,
  };
};

export const GmailUsefulDetailCard = ({
  detail,
  mailboxId,
  onDismiss,
  onOpen,
}: {
  detail: GmailUsefulDetail;
  mailboxId: string;
  onDismiss?: () => void;
  onOpen?: () => void;
}) => {
  const queryClient = useQueryClient();
  const feedbackMutation = useMutation({
    ...orpc.mail.setGmailUsefulDetailFeedback.mutationOptions(),
    onError: () => {
      toast.error("Could not save your preference.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getGmailUsefulDetailsQueryKey(mailboxId) });
    },
  });
  const copyValue =
    detail.kind === "verification_code" ? detail.code : (detail.trackingNumber ?? detail.reference);
  const metadata = getDetailMetadata(detail);
  const detailText = getDetailText(detail, metadata);
  const feedback = feedbackMutation.isError
    ? detail.feedback
    : (feedbackMutation.variables?.feedback ?? detail.feedback);
  const content = (
    <span className="block min-w-0">
      <span className="block text-sm/5 font-semibold wrap-break-word text-foreground">
        {detailText.headline}
      </span>
      {metadata.length > 0 && (
        <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs/4 font-medium text-foreground/70">
          {metadata.map((value) => (
            <span className="wrap-break-word" key={value}>
              {value}
            </span>
          ))}
        </span>
      )}
      {detailText.kicker && (
        <span className="mt-1.5 block text-xs/4 wrap-break-word text-muted-foreground">
          {detailText.kicker}
        </span>
      )}
    </span>
  );

  return (
    <div className="relative">
      <article
        className={cn(
          "relative z-10 grid min-w-0 grid-cols-1 items-start gap-x-3 gap-y-2 rounded-xl border px-4 py-3.5 shadow-xs sm:grid-cols-[minmax(0,1fr)_auto]",
          {
            "border-border/70 bg-card": detail.kind !== "security_alert",
            "border-destructive/30 bg-card": detail.kind === "security_alert",
          },
        )}
      >
        {onOpen ? (
          <button
            className="min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={onOpen}
            type="button"
          >
            {content}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{content}</div>
        )}

        <div className="flex shrink-0 items-center gap-0.5 justify-self-end">
          {copyValue && (
            <Button
              className="mr-1 h-8 px-2.5 text-xs"
              onClick={() => void copyText(copyValue)}
              size="sm"
              type="button"
              variant="outline"
            >
              Copy
            </Button>
          )}

          <IconButtonTooltip label="Useful">
            <button
              aria-label="Mark as useful"
              aria-pressed={feedback === "useful"}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
                {
                  "bg-muted text-foreground": feedback === "useful",
                },
              )}
              disabled={feedbackMutation.isPending}
              onClick={() =>
                feedbackMutation.mutate({ feedback: "useful", id: detail.id, mailboxId })
              }
              type="button"
            >
              <HugeiconsIcon aria-hidden className="size-4" icon={ThumbsUpIcon} />
            </button>
          </IconButtonTooltip>

          <IconButtonTooltip label="Not useful">
            <button
              aria-label="Mark as not useful"
              aria-pressed={feedback === "not_useful"}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
                {
                  "bg-muted text-foreground": feedback === "not_useful",
                },
              )}
              disabled={feedbackMutation.isPending}
              onClick={() =>
                feedbackMutation.mutate({ feedback: "not_useful", id: detail.id, mailboxId })
              }
              type="button"
            >
              <HugeiconsIcon aria-hidden className="size-4" icon={ThumbsDownIcon} />
            </button>
          </IconButtonTooltip>

          {onDismiss && (
            <IconButtonTooltip label="Dismiss">
              <button
                aria-label="Dismiss useful detail"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                onClick={onDismiss}
                type="button"
              >
                <HugeiconsIcon aria-hidden className="size-4" icon={Cancel01Icon} />
              </button>
            </IconButtonTooltip>
          )}
        </div>
      </article>
    </div>
  );
};
