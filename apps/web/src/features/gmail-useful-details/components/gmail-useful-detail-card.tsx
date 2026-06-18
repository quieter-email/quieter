"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, IconButtonTooltip, cn, toast } from "@quieter/ui";

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
    detail.summary,
    detail.kind === "delivery" && detail.status ? deliveryStatusLabels[detail.status] : null,
    detail.eventAt ? eventDateFormatter.format(new Date(detail.eventAt)) : null,
    detail.location,
    detail.reference,
  ].filter((value): value is string => Boolean(value));
};

export const GmailUsefulDetailCard = ({
  detail,
  onDismiss,
  onOpen,
}: {
  detail: GmailUsefulDetail;
  onDismiss?: () => void;
  onOpen?: () => void;
}) => {
  const copyValue =
    detail.kind === "verification_code" ? detail.code : (detail.trackingNumber ?? detail.reference);
  const metadata = getDetailMetadata(detail);
  const content = (
    <>
      <span className="truncate font-medium text-foreground">{detail.title}</span>
      {metadata.length > 0 && (
        <span className="flex min-w-0 items-center gap-2 overflow-hidden text-muted-foreground">
          {metadata.map((value) => (
            <span className="truncate" key={value}>
              {value}
            </span>
          ))}
        </span>
      )}
    </>
  );

  return (
    <article
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-sm",
        {
          "border-border/70 bg-muted/55": detail.kind !== "security_alert",
          "border-destructive/25 bg-destructive/8": detail.kind === "security_alert",
        },
      )}
    >
      {onOpen ? (
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={onOpen}
          type="button"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{content}</div>
      )}

      {copyValue && (
        <Button
          className="h-7 shrink-0 px-2 text-xs"
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
    </article>
  );
};
