import {
  SettingsErrorState,
  SettingsLoadingState,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { campaignRecipientStatusSchema } from "@quieter/mail/campaigns";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { EmailPreview } from "@quieter/ui/email-editor";
import type { PillTone } from "@quieter/ui/pill";
import { Pill } from "@quieter/ui/pill";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@quieter/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import {
  SettingsSectionLayout,
  SettingsInsetRow,
} from "@quieter/ui/settings-layout";
import { Surface } from "@quieter/ui/surface";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { BroadcastHeader } from "./broadcast-elements";
import { useBroadcastWorkspace } from "./broadcast-workspace";
import { CampaignEditor } from "./campaign-editor";
import { CampaignStatus } from "./campaign-status";

const recipientTones = {
  canceled: "gray",
  excluded: "gray",
  failed: "red",
  pending: "gray",
  sending: "blue",
  sent: "green",
  uncertain: "orange",
} satisfies Record<string, PillTone>;

const recipientLabels = {
  canceled: "Canceled",
  excluded: "Excluded",
  failed: "Failed",
  pending: "Pending",
  sending: "Sending",
  sent: "Sent",
  uncertain: "Confirmation pending",
};

export const CampaignDetail = ({ campaignId }: { campaignId: string }) => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("all");
  const [confirmAction, setConfirmAction] = useState<"cancel" | "retry">();
  const campaign = useQuery({
    queryFn: async () =>
      await rpc.campaigns.get({
        campaignId,
        limit: 50,
        offset,
        organizationId,
        status: campaignRecipientStatusSchema.safeParse(status).data,
      }),
    queryKey: ["campaigns", organizationId, campaignId, offset, status],
    refetchInterval: (query) =>
      query.state.data &&
      ["queued", "sending"].includes(query.state.data.campaign.status)
        ? 5000
        : false,
  });
  const action = useMutation({
    mutationFn: async (operation: "cancel" | "retry") =>
      operation === "cancel"
        ? await rpc.campaigns.cancel({ campaignId, organizationId })
        : await rpc.campaigns.retry({ campaignId, organizationId }),
    onError: (error) => {
      toastError(error, {
        boundary: "campaign-actions",
        fallback: "Could not update campaign. Please try again.",
      });
    },
    onSuccess: async () => {
      setConfirmAction(undefined);
      await queryClient.invalidateQueries({
        queryKey: ["campaigns", organizationId],
      });
    },
  });
  if (campaign.isPending) {
    return <SettingsLoadingState label="Loading campaign" />;
  }
  if (campaign.isError) {
    return (
      <SettingsErrorState
        message="Could not load campaign."
        onRetry={() => void campaign.refetch()}
      />
    );
  }
  const { campaign: item, counts, deliveryCounts } = campaign.data;
  if (item.status === "draft") {
    return <CampaignEditor campaign={item} key={item.id} />;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const processed = total - counts.pending - counts.sending;
  let actionContent: ReactNode;
  if (action.isPending) {
    actionContent = "Updating…";
  } else {
    actionContent =
      confirmAction === "cancel" ? "Cancel remaining" : "Retry failed";
  }
  return (
    <div className="flex flex-col gap-0.5">
      <BroadcastHeader
        back="campaigns"
        title={item.name}
        action={
          <div className="flex items-center gap-2">
            <CampaignStatus status={item.status} />
            <Button
              disabled={campaign.isFetching}
              onClick={() => void campaign.refetch()}
              size="default"
              variant="ghost"
            >
              Refresh results
            </Button>
          </div>
        }
        description={item.subject}
      />
      <div className="space-y-6 p-4">
        <SettingsSectionLayout title="Delivery progress">
          <Surface padding="compact">
            <div className="space-y-4 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p aria-live="polite" className="text-body text-fg">
                  {processed.toLocaleString()} of {total.toLocaleString()}{" "}
                  recipients processed
                </p>
                {canManage ? (
                  <div className="flex gap-2">
                    {counts.failed > 0 && item.status !== "canceled" ? (
                      <Button
                        disabled={action.isPending}
                        onClick={() => {
                          setConfirmAction("retry");
                        }}
                        size="default"
                        variant="secondary"
                      >
                        Retry failed
                      </Button>
                    ) : null}
                    {["queued", "sending", "paused"].includes(item.status) ? (
                      <Button
                        disabled={action.isPending}
                        onClick={() => {
                          setConfirmAction("cancel");
                        }}
                        size="default"
                        variant="destructive"
                      >
                        Cancel remaining
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <Progress
                aria-label="Campaign progress"
                max={Math.max(total, 1)}
                value={processed}
              >
                <ProgressTrack>
                  <ProgressIndicator />
                </ProgressTrack>
              </Progress>
            </div>
            <Surface chrome="inset" variant="detail">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {Object.entries(counts).map(([label, count]) => (
                  <div key={label}>
                    <dt className="text-caption text-muted-fg">
                      {label === "uncertain"
                        ? "Confirmation pending"
                        : label.charAt(0).toUpperCase() + label.slice(1)}
                    </dt>
                    <dd className="mt-1 text-title-sm text-fg">
                      {count.toLocaleString()}
                    </dd>
                  </div>
                ))}
              </dl>
            </Surface>
            <div className="space-y-4 p-3.5">
              {counts.uncertain > 0 ? (
                <p className="text-caption/5 text-muted-fg">
                  Some deliveries are waiting for confirmation. Retrying failed
                  recipients does not resend these messages.
                </p>
              ) : null}
              {item.status === "paused" ? (
                <p className="text-body text-muted-fg">
                  {counts.failed > 0
                    ? "Sending is paused. Review failed recipients and retry when the issue is resolved."
                    : "Delivery confirmations are pending. Refresh results to check for updates."}
                </p>
              ) : null}
              <p className="text-caption/5 text-muted-fg">
                {["queued", "sending"].includes(item.status)
                  ? "Sending continues when you leave this page. Progress updates automatically."
                  : "The original recipient selection and message are preserved for this campaign."}
              </p>
            </div>
          </Surface>
        </SettingsSectionLayout>
        <SettingsSectionLayout title="Delivery results">
          <Surface padding="compact">
            <Surface chrome="inset" variant="detail">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {Object.entries(deliveryCounts).map(([label, count]) => (
                  <div key={label}>
                    <dt className="text-caption text-muted-fg">
                      {label.charAt(0).toUpperCase() + label.slice(1)}
                    </dt>
                    <dd className="mt-1 text-title-sm text-fg">
                      {count.toLocaleString()}
                    </dd>
                  </div>
                ))}
              </dl>
            </Surface>
          </Surface>
          <p className="text-caption/5 text-muted-fg">
            Delivery and engagement results can arrive after sending finishes.
          </p>
        </SettingsSectionLayout>
        <SettingsSectionLayout title="Recipients">
          <Select
            items={[
              { label: "All outcomes", value: "all" },
              ...campaignRecipientStatusSchema.options.map((value) => ({
                label: recipientLabels[value],
                value,
              })),
            ]}
            onValueChange={(value) => {
              setStatus(value ?? "all");
              setOffset(0);
            }}
            value={status}
          >
            <SelectTrigger aria-label="Filter recipient outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectList>
                <SelectItem value="all">All outcomes</SelectItem>
                {campaignRecipientStatusSchema.options.map((value) => (
                  <SelectItem key={value} value={value}>
                    {recipientLabels[value]}
                  </SelectItem>
                ))}
              </SelectList>
            </SelectContent>
          </Select>
          <div className="@container">
            <ul className="flex flex-col gap-0.5">
              {campaign.data.recipients.length === 0 ? (
                <li className="px-5 py-8 text-center text-body text-muted-fg">
                  No recipients match this outcome.
                </li>
              ) : (
                campaign.data.recipients.map((recipient) => (
                  <li key={recipient.id}>
                    <SettingsInsetRow>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm text-fg">
                          {recipient.name || recipient.email}
                        </p>
                        {recipient.name ? (
                          <p className="truncate text-caption text-muted-fg">
                            {recipient.email}
                          </p>
                        ) : null}
                        {recipient.exclusionReason ? (
                          <p className="text-caption text-muted-fg">
                            {recipient.exclusionReason.replaceAll("_", " ")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Pill size="xs" tone={recipientTones[recipient.status]}>
                          {recipientLabels[recipient.status]}
                        </Pill>
                        {recipient.deliveryStatus ? (
                          <Pill size="xs">
                            {recipient.deliveryStatus.replaceAll("_", " ")}
                          </Pill>
                        ) : null}
                      </div>
                    </SettingsInsetRow>
                  </li>
                ))
              )}
            </ul>
          </div>
          {offset > 0 || campaign.data.nextOffset !== null ? (
            <div className="flex justify-end gap-2">
              <Button
                disabled={offset === 0}
                onClick={() => {
                  setOffset(Math.max(0, offset - 50));
                }}
                size="default"
                variant="ghost"
              >
                Previous
              </Button>
              <Button
                disabled={campaign.data.nextOffset === null}
                onClick={() => {
                  setOffset(campaign.data.nextOffset ?? offset);
                }}
                size="default"
                variant="secondary"
              >
                Next
              </Button>
            </div>
          ) : null}
        </SettingsSectionLayout>
        <SettingsSectionLayout title="Sent message">
          <Surface padding="compact">
            <div className="space-y-3 p-3.5">
              <p className="text-caption text-muted-fg">From {item.from}</p>
              <p className="text-body font-medium text-fg">{item.subject}</p>
              <EmailPreview html={item.html} text={item.text} />
            </div>
          </Surface>
        </SettingsSectionLayout>
        {campaign.data.events.length ? (
          <SettingsSectionLayout title="Recent activity">
            <ol className="flex flex-col gap-0.5">
              {campaign.data.events.map((event) => (
                <li
                  className="flex flex-wrap justify-between gap-2 py-3 text-caption"
                  key={`${event.recipient}-${event.eventType}-${event.occurredAt}`}
                >
                  <span className="break-all text-fg">
                    {event.recipient}, {event.eventType.replaceAll("_", " ")}
                  </span>
                  <time className="text-muted-fg">
                    {new Date(event.occurredAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          </SettingsSectionLayout>
        ) : null}
      </div>
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open && !action.isPending) {
            setConfirmAction(undefined);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "cancel"
                ? "Cancel remaining deliveries?"
                : "Retry failed recipients?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "cancel"
                ? "Messages already sent stay sent. Canceling stops work that has not been submitted."
                : "Only recipients with a safe, confirmed failure are retried. Sent messages and deliveries awaiting confirmation are preserved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              disabled={action.isPending}
              onClick={() => {
                setConfirmAction(undefined);
              }}
              size="default"
              variant="secondary"
            >
              Go back
            </Button>
            <Button
              disabled={action.isPending}
              onClick={() => {
                if (confirmAction) {
                  action.mutate(confirmAction);
                }
              }}
              size="default"
              variant={confirmAction === "cancel" ? "destructive" : "default"}
            >
              {actionContent}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
