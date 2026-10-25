"use client";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
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
import { useState } from "react";

export const MailboxRemovalSettings = ({
  emailAddress,
  isPending,
  kind,
  onRemove,
}: {
  emailAddress: string;
  isPending: boolean;
  kind: "gmail" | "managed";
  onRemove: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const isManaged = kind === "managed";

  return (
    <>
      <SettingsSection title={isManaged ? "Delete mailbox" : "Remove mailbox"}>
        <SettingsCard>
          <SettingsRow
            action={
              <Button
                disabled={isPending}
                onClick={() => {
                  setOpen(true);
                }}
                size="sm"
                type="button"
                variant="destructive"
              >
                <Icon aria-hidden icon={Delete02Icon} />
                {isManaged ? "Delete mailbox" : "Remove"}
              </Button>
            }
            title={
              isManaged ? "Permanently delete this mailbox" : "Disconnect Gmail"
            }
          >
            {isManaged
              ? "Delete this mailbox and its saved mail for everyone with access."
              : "Remove this account and its saved credentials from Quieter."}
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!isPending) {
            setOpen(nextOpen);
          }
        }}
        open={open}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isManaged ? "Delete" : "Remove"} {emailAddress}?
            </DialogTitle>
            <DialogDescription>
              {isManaged
                ? "This permanently deletes the mailbox and cannot be undone."
                : "You can reconnect this account later."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody spacing="3">
            {isManaged ? (
              <>
                <p className="text-body text-muted-fg">
                  Messages and drafts stored in this mailbox, its settings, and
                  everyone&apos;s access will be deleted. Your domain stays
                  connected.
                </p>
                <p className="text-body text-muted-fg">
                  Mail also saved in your team&apos;s API history stays there.
                </p>
              </>
            ) : (
              <p className="text-body text-muted-fg">
                Quieter will remove its saved credentials and mailbox data. Your
                Google account and messages in Gmail stay unchanged.
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton disabled={isPending}>Cancel</DialogCloseButton>
            <Button
              disabled={isPending}
              onClick={onRemove}
              pending={isPending}
              pendingLabel={isManaged ? "Deleting…" : "Removing…"}
              size="sm"
              type="button"
              variant="destructive"
            >
              {isManaged ? "Delete mailbox" : "Remove mailbox"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
