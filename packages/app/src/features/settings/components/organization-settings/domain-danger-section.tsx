"use client";

import { Delete02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { DomainDetail } from "@quieter/app/features/settings/components/organization-settings/domain-status";
import { MutedActionButton } from "@quieter/app/features/settings/components/organization-settings/settings-row";
import {
  SettingsCard,
  SettingsFieldRow,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
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
import { Icon } from "@quieter/ui/icon";
import { Text } from "@quieter/ui/text";
import type { UseMutationResult } from "@tanstack/react-query";

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
      <SettingsCard>
        <SettingsFieldRow
          action={
            showRemoveDomainMutedAction(
              manageReason,
              data.managedMailboxCount
            ) ? (
              <MutedActionButton
                icon={<Icon aria-hidden icon={Delete02Icon} />}
                label="Remove"
                reason={
                  manageReason ??
                  "Shared inboxes must be removed or migrated before removing this domain."
                }
                variant="destructive"
              />
            ) : (
              <Button
                onClick={() => {
                  setRemoveOpen(true);
                }}
                size="sm"
                variant="destructive"
              >
                <Icon aria-hidden icon={Delete02Icon} />
                Remove
              </Button>
            )
          }
          label="Remove domain"
          value={
            data.managedMailboxCount > 0
              ? `Remove or migrate ${data.managedMailboxCount} shared ${data.managedMailboxCount === 1 ? "inbox" : "inboxes"} first.`
              : "This stops Quieter from sending or receiving mail for the domain."
          }
        />
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
        <DialogBody spacing="3">
          <Text tone="muted">
            Sending and incoming mail will stop for this domain.
          </Text>
          <Text tone="muted">
            Remove the DNS records at your provider after this domain is
            disconnected.
          </Text>
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
            <Icon
              aria-hidden
              animation={removeMutation.isPending ? "spin" : undefined}
              icon={removeMutation.isPending ? Loading03Icon : Delete02Icon}
            />
            Remove domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
);
