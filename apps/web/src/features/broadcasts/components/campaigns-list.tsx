import { Add01Icon, MailSend02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, LinkButton } from "@quieter/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { rpc } from "#/lib/orpc";

import {
  BroadcastError,
  BroadcastHeader,
  BroadcastLoading,
} from "./broadcast-elements";
import { useBroadcastWorkspace } from "./broadcast-workspace";
import { CampaignStatus } from "./campaign-status";

/* oxlint-disable eslint/no-nested-ternary, unicorn/no-nested-ternary -- Loading, empty, and campaign list states are exclusive. */
export const CampaignsList = () => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const [offset, setOffset] = useState(0);
  const campaigns = useQuery({
    queryFn: async () =>
      await rpc.campaigns.list({ limit: 50, offset, organizationId }),
    queryKey: ["campaigns", organizationId, "list", offset],
    refetchInterval: (query) =>
      query.state.data?.campaigns.some(
        (item) => item.status === "queued" || item.status === "sending"
      ) === true
        ? 10_000
        : false,
  });
  return (
    <div className="flex flex-col gap-6">
      <BroadcastHeader
        action={
          canManage ? (
            <LinkButton
              search={{ organizationId }}
              size="sm"
              to="/campaigns/new"
            >
              <HugeiconsIcon aria-hidden icon={Add01Icon} />
              Create campaign
            </LinkButton>
          ) : undefined
        }
        title="Campaigns"
      />
      {campaigns.isPending ? (
        <BroadcastLoading label="Loading campaigns" />
      ) : campaigns.isError ? (
        <BroadcastError onRetry={() => void campaigns.refetch()} />
      ) : campaigns.data.campaigns.length === 0 ? (
        <div className="grid min-h-80 place-content-center gap-3 rounded-xl border border-dashed border-border text-center">
          <HugeiconsIcon
            aria-hidden
            className="mx-auto size-6 text-muted-fg"
            icon={MailSend02Icon}
          />
          <p className="text-body text-muted-fg">
            {offset ? "No more campaigns" : "Your next message starts here"}
          </p>
          {canManage && offset === 0 ? (
            <LinkButton
              search={{ organizationId }}
              size="sm"
              to="/campaigns/new"
              variant="outline"
            >
              Create campaign
            </LinkButton>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {campaigns.data.campaigns.map((campaign) => (
            <div
              className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0"
              key={campaign.id}
            >
              <div className="min-w-0 flex-1">
                <LinkButton
                  params={{ campaignId: campaign.id }}
                  search={{ organizationId }}
                  size="sm"
                  to={
                    campaign.status === "draft"
                      ? "/campaigns/$campaignId/content"
                      : "/campaigns/$campaignId"
                  }
                  variant="ghost"
                >
                  {campaign.name}
                </LinkButton>
                <p className="mt-1 truncate pl-2.5 text-caption text-muted-fg">
                  {campaign.subject || "No subject yet"}
                </p>
              </div>
              <CampaignStatus status={campaign.status} />
              <span className="hidden text-caption text-muted-fg sm:block">
                {new Date(campaign.updatedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
      {offset > 0 ||
      (campaigns.data?.nextOffset !== null &&
        campaigns.data?.nextOffset !== undefined) ? (
        <div className="flex justify-end gap-2">
          <Button
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 50));
            }}
            size="sm"
            variant="ghost"
          >
            Previous
          </Button>
          <Button
            disabled={
              campaigns.data?.nextOffset === null ||
              campaigns.data?.nextOffset === undefined
            }
            onClick={() => {
              setOffset(campaigns.data?.nextOffset ?? offset);
            }}
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
};
