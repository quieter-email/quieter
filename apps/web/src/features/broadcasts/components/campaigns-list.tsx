import { Add01Icon, MailSend02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRows,
} from "#/features/settings/components/settings-layout";
import { toastError } from "#/lib/error-toast";
import { rpc } from "#/lib/orpc";

import { useBroadcastWorkspace } from "./broadcast-workspace";
import { CampaignStatus } from "./campaign-status";

export const CampaignsList = () => {
  const { organizationId, canManage } = useBroadcastWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [audienceId, setAudienceId] = useState("");
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
  const audiences = useQuery({
    enabled: open,
    queryFn: async () =>
      await rpc.audiences.list({ limit: 100, organizationId }),
    queryKey: ["audiences", organizationId, "campaign-picker"],
  });
  const create = useMutation({
    mutationFn: async () =>
      await rpc.campaigns.create({
        audienceId,
        from: "",
        name,
        organizationId,
        segmentIds: [],
        subject: "",
        text: "",
      }),
    onError: (error) => {
      toastError(error, {
        boundary: "campaigns",
        fallback: "Could not create campaign. Please try again.",
      });
    },
    onSuccess: async (campaign) => {
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["campaigns", organizationId],
      });
      void navigate({
        params: { campaignId: campaign.id },
        search: { organizationId },
        to: "/campaigns/$campaignId",
      });
    },
  });
  let campaignsContent: ReactNode;
  if (campaigns.isPending) {
    campaignsContent = <SettingsLoadingState label="Loading campaigns" />;
  } else if (campaigns.isError) {
    campaignsContent = (
      <SettingsErrorState
        message="Could not load campaigns."
        onRetry={() => void campaigns.refetch()}
      />
    );
  } else if (campaigns.data.campaigns.length === 0) {
    campaignsContent = (
      <div className="rounded-lg border border-border px-6 py-14 text-center">
        <HugeiconsIcon
          aria-hidden
          className="mx-auto mb-3 size-6 text-muted-fg"
          icon={MailSend02Icon}
        />
        <p className="text-body text-fg">
          {offset ? "No more campaigns" : "Your next message starts here"}
        </p>
        <p className="mt-1 text-body text-muted-fg">
          Create a draft and choose an audience before sending.
        </p>
      </div>
    );
  } else {
    campaignsContent = (
      <SettingsRows>
        {campaigns.data.campaigns.map((campaign) => (
          <SettingsNavigationRow
            key={campaign.id}
            title={campaign.name}
            description={campaign.subject || "No subject yet"}
            meta={<CampaignStatus status={campaign.status} />}
            onClick={() =>
              void navigate({
                params: { campaignId: campaign.id },
                search: { organizationId },
                to: "/campaigns/$campaignId",
              })
            }
          />
        ))}
      </SettingsRows>
    );
  }
  let audiencesContent: ReactNode;
  if (audiences.isError) {
    audiencesContent = (
      <SettingsErrorState
        message="Could not load audiences."
        onRetry={() => void audiences.refetch()}
      />
    );
  } else {
    audiencesContent =
      audiences.data?.items.length === 0 ? (
        <p className="text-body text-muted-fg">
          Create an audience first, then return to start your campaign.
        </p>
      ) : null;
  }
  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Campaigns"
        action={
          canManage ? (
            <Button
              onClick={() => {
                setName("");
                setAudienceId("");
                setOpen(true);
              }}
              size="sm"
            >
              <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
              Create campaign
            </Button>
          ) : undefined
        }
      >
        Write once, review your audience, and follow each delivery.
      </SettingsPageHeader>
      {campaignsContent}
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Create campaign</DialogTitle>
            </DialogHeader>
            <DialogBody spacing="4">
              <Field>
                <FieldLabel>Campaign name</FieldLabel>
                <Input
                  maxLength={200}
                  required
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  placeholder="October newsletter"
                  value={name}
                />
              </Field>
              <Field>
                <FieldLabel>Audience</FieldLabel>
                <Select
                  items={
                    audiences.data?.items.map((item) => ({
                      label: item.name,
                      value: item.id,
                    })) ?? []
                  }
                  onValueChange={(value) => {
                    setAudienceId(value ?? "");
                  }}
                  value={audienceId}
                >
                  <SelectTrigger
                    aria-label="Campaign audience"
                    pending={audiences.isPending}
                  >
                    <SelectValue placeholder="Choose an audience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectList>
                      {audiences.data?.items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectList>
                  </SelectContent>
                </Select>
              </Field>
              {audiencesContent}
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton disabled={create.isPending}>
                Cancel
              </DialogCloseButton>
              <Button
                disabled={create.isPending || !name.trim() || !audienceId}
                size="sm"
                type="submit"
              >
                {create.isPending ? "Creating…" : "Create draft"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
