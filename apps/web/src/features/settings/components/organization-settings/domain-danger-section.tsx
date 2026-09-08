"use client";

import { Delete02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import type { UseMutationResult } from "@tanstack/react-query";

import { SettingsCard, SettingsSection } from "../settings-layout";
import type { DomainDetail } from "./domain-status";
import { MutedActionButton } from "./settings-row";

const showRemoveDomainMutedAction = (
  manageReason: string | null,
  managedMailboxCount: number
) => manageReason !== null || managedMailboxCount > 0;

export const DomainDangerSection = ({
  data,
  domain,
  manageReason,
  onRemove,
  removeMutation,
  removeOpen,
  setRemoveOpen,
}: {
  data: RouterOutputs["mailDomains"]["get"];
  domain: DomainDetail;
  manageReason: string | null;
  onRemove: () => void;
  removeMutation: UseMutationResult<
    RouterOutputs["mailDomains"]["remove"],
    unknown,
    RouterInputs["mailDomains"]["remove"]
  >;
  removeOpen: boolean;
  setRemoveOpen: (open: boolean) => void;
}) => (
  <>
    <SettingsSection
      description="Removal releases the domain from this team. DNS records are not removed at your provider."
      title="Danger zone"
    >
      <SettingsCard className="p-5">
        <div className="@container flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
          <div>
            <p className="text-body font-medium text-fg">Remove domain</p>
            <p className="mt-1 text-caption/5 text-muted-fg">
              {data.managedMailboxCount > 0
                ? `Remove or migrate ${data.managedMailboxCount} shared ${data.managedMailboxCount === 1 ? "inbox" : "inboxes"} first.`
                : "This stops Quieter from sending or receiving mail for the domain."}
            </p>
          </div>
          {showRemoveDomainMutedAction(
            manageReason,
            data.managedMailboxCount
          ) ? (
            <MutedActionButton
              icon={
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Delete02Icon}
                />
              }
              label="Remove"
              reason={
                manageReason ??
                "Shared inboxes must be removed or migrated before removing this domain."
              }
            />
          ) : (
            <Button
              onClick={() => {
                setRemoveOpen(true);
              }}
              size="sm"
              variant="destructive"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-4"
                icon={Delete02Icon}
              />
              Remove
            </Button>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>

    <Dialog onOpenChange={setRemoveOpen} open={removeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {domain.domain}?</DialogTitle>
          <DialogDescription>
            This action disconnects the domain from Quieter.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-body text-muted-fg">
          <p>Sending and incoming mail will stop for this domain.</p>
          <p>
            Remove the DNS records at your provider after this domain is
            disconnected.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton disabled={removeMutation.isPending}>
            Cancel
          </DialogCloseButton>
          <Button
            disabled={removeMutation.isPending}
            onClick={onRemove}
            size="sm"
            variant="destructive"
          >
            <HugeiconsIcon
              aria-hidden
              className={cn("size-4", {
                "animate-spin": removeMutation.isPending,
              })}
              icon={removeMutation.isPending ? Loading03Icon : Delete02Icon}
            />
            Remove domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
);
