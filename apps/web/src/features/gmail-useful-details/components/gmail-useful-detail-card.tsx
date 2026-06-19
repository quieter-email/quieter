"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, IconButtonTooltip, cn, toast } from "@quieter/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  const [mobileExpanded, setMobileExpanded] = useState(false);
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
  const feedback = feedbackMutation.isError
    ? detail.feedback
    : (feedbackMutation.variables?.feedback ?? detail.feedback);
  const content = (
    <span className="block min-w-0">
      <span
        className={cn(
          "block truncate font-medium text-foreground transition-[white-space] sm:group-focus-within/detail:text-clip sm:group-focus-within/detail:whitespace-normal sm:group-hover/detail:text-clip sm:group-hover/detail:whitespace-normal",
          {
            "text-clip whitespace-normal": mobileExpanded,
          },
        )}
      >
        {detail.title}
      </span>
      {detail.summary && (
        <span
          className={cn(
            "mt-0.5 block max-h-5 overflow-hidden text-sm/5 wrap-break-word text-foreground/90 transition-[max-height] duration-200 ease-out sm:group-focus-within/detail:max-h-40 sm:group-hover/detail:max-h-40",
            {
              "max-h-40": mobileExpanded,
            },
          )}
        >
          {detail.summary}
        </span>
      )}
      {metadata.length > 0 && (
        <span
          className={cn(
            "mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 overflow-hidden text-muted-foreground transition-[max-height] duration-200 ease-out sm:group-focus-within/detail:max-h-24 sm:group-hover/detail:max-h-24",
            {
              "max-h-24": mobileExpanded,
              "max-h-4": detail.kind === "verification_code" && !mobileExpanded,
              "max-h-0": detail.kind !== "verification_code" && !mobileExpanded,
            },
          )}
        >
          {metadata.map((value) => (
            <span className="wrap-break-word" key={value}>
              {value}
            </span>
          ))}
        </span>
      )}
    </span>
  );

  return (
    <div className="group/detail relative min-h-16">
      <article
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 text-xs shadow-sm transition-[box-shadow,background-color] duration-200 sm:group-focus-within/detail:z-30 sm:group-focus-within/detail:shadow-lg sm:group-hover/detail:z-30 sm:group-hover/detail:shadow-lg",
          {
            "border-border/70 bg-muted": detail.kind !== "security_alert",
            "border-destructive/25 bg-destructive/15": detail.kind === "security_alert",
            "z-30 shadow-lg": mobileExpanded,
          },
        )}
      >
        {onOpen ? (
          <button
            className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={onOpen}
            type="button"
          >
            {content}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{content}</div>
        )}

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <Button
              aria-expanded={mobileExpanded}
              className="h-7 px-2 text-xs sm:hidden"
              onClick={() => setMobileExpanded((expanded) => !expanded)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {mobileExpanded ? "Less" : "More"}
            </Button>

            {copyValue && (
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => void copyText(copyValue)}
                size="sm"
                type="button"
                variant="outline"
              >
                Copy
              </Button>
            )}

            {onDismiss && (
              <IconButtonTooltip label="Dismiss">
                <button
                  aria-label="Dismiss useful detail"
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground outline-none hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={onDismiss}
                  type="button"
                >
                  <HugeiconsIcon aria-hidden className="size-3.5" icon={Cancel01Icon} />
                </button>
              </IconButtonTooltip>
            )}
          </div>

          <div
            aria-label="Was this useful?"
            className={cn(
              "hidden items-center gap-0.5 sm:group-focus-within/detail:flex sm:group-hover/detail:flex",
              {
                flex: mobileExpanded,
              },
            )}
          >
            <Button
              className="h-7 px-2 text-xs"
              aria-pressed={feedback === "useful"}
              disabled={feedbackMutation.isPending}
              onClick={() =>
                feedbackMutation.mutate({ feedback: "useful", id: detail.id, mailboxId })
              }
              size="sm"
              type="button"
              variant={feedback === "useful" ? "outline" : "ghost"}
            >
              Useful
            </Button>
            <Button
              aria-pressed={feedback === "not_useful"}
              className="h-7 px-2 text-xs"
              disabled={feedbackMutation.isPending}
              onClick={() =>
                feedbackMutation.mutate({ feedback: "not_useful", id: detail.id, mailboxId })
              }
              size="sm"
              type="button"
              variant={feedback === "not_useful" ? "outline" : "ghost"}
            >
              Not useful
            </Button>
          </div>
        </div>
      </article>
    </div>
  );
};
