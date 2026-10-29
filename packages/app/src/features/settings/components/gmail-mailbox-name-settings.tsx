"use client";

import {
  SettingsCard,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { TextFieldInput } from "@quieter/ui/text-field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export const GmailMailboxNameSettings = ({
  mailbox,
}: {
  mailbox: {
    displayName: string | null;
    emailAddress: string;
    id: string;
  };
}) => {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(
    mailbox.displayName?.trim() ?? ""
  );
  const updateDisplayNameMutation = useMutation({
    ...orpc.mail.updateGmailMailboxDisplayName.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
    },
  });
  const savedDisplayName = mailbox.displayName?.trim() ?? "";
  const isDirty = displayName.trim() !== savedDisplayName;

  return (
    <SettingsSection
      description="Choose how this mailbox appears in quieter. Its Gmail address remains visible beneath the name."
      title="Mailbox name"
    >
      <SettingsCard>
        <form
          className={cn(
            settingsSurfaceVariants({ variant: "form" }),
            settingsSurfaceVariants({ variant: "padding" })
          )}
          onSubmit={(event) => {
            event.preventDefault();
            if (!isDirty) {
              return;
            }
            updateDisplayNameMutation.mutate(
              {
                displayName: displayName.trim() || null,
                mailboxId: mailbox.id,
              },
              {
                onError: (error) => {
                  toastError(error, {
                    boundary: "mailbox-settings",
                    fallback: "Could not save mailbox name.",
                  });
                },
              }
            );
          }}
        >
          <TextFieldInput
            aria-label={`Name for ${mailbox.emailAddress}`}
            className="min-w-0 flex-1"
            disabled={updateDisplayNameMutation.isPending}
            maxLength={120}
            onChange={(event) => {
              setDisplayName(event.currentTarget.value);
            }}
            placeholder="Gmail"
            value={displayName}
          />
          <Button
            disabled={!isDirty}
            pending={updateDisplayNameMutation.isPending}
            pendingLabel="Saving…"
            type="submit"
          >
            Save name
          </Button>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
};
