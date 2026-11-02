import {
  Add01Icon,
  ArrowRight01Icon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { rpc } from "@quieter/app/lib/orpc";
import { Button, LinkButton } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import {
  settingsNavigationRowVariants,
  SettingsRows,
} from "@quieter/ui/settings-layout";
import { Text } from "@quieter/ui/text";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

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
    <div className="flex flex-col gap-0.5">
      <BroadcastHeader
        action={
          canManage ? (
            <LinkButton
              search={{ organizationId }}
              size="default"
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
        <div className="grid min-h-80 place-content-center gap-3 p-4 text-center">
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
              size="default"
              to="/campaigns/new"
              variant="secondary"
            >
              Create campaign
            </LinkButton>
          ) : null}
        </div>
      ) : (
        <SettingsRows variant="plain">
          {campaigns.data.campaigns.map((campaign) => (
            <Link
              className={settingsNavigationRowVariants({
                chrome: "standalone",
              })}
              key={campaign.id}
              params={{ campaignId: campaign.id }}
              search={{ organizationId }}
              to={
                campaign.status === "draft"
                  ? "/campaigns/$campaignId/content"
                  : "/campaigns/$campaignId"
              }
            >
              <span className="min-w-0 flex-1">
                <Text as="span" className="block" truncate weight="medium">
                  {campaign.name}
                </Text>
                <Text
                  as="span"
                  className="mt-0.5 block"
                  size="sm"
                  tone="muted"
                  truncate
                >
                  {campaign.subject || "No subject yet"}
                </Text>
              </span>
              <span className="w-35 shrink-0">
                <CampaignStatus status={campaign.status} />
              </span>
              <Text
                as="span"
                className="hidden w-24 shrink-0 text-right sm:block"
                size="caption"
                tone="muted"
              >
                {new Date(campaign.updatedAt).toLocaleDateString()}
              </Text>
              <Icon aria-hidden tone="muted" icon={ArrowRight01Icon} />
            </Link>
          ))}
        </SettingsRows>
      )}
      {offset > 0 ||
      (campaigns.data?.nextOffset !== null &&
        campaigns.data?.nextOffset !== undefined) ? (
        <div className="flex justify-end gap-2 p-4">
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
            disabled={
              campaigns.data?.nextOffset === null ||
              campaigns.data?.nextOffset === undefined
            }
            onClick={() => {
              setOffset(campaigns.data?.nextOffset ?? offset);
            }}
            size="default"
            variant="secondary"
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
};
