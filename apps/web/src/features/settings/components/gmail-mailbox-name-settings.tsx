"use client";

import { Button } from "@quieter/ui/button";
import { TextFieldInput } from "@quieter/ui/text-field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { showMutationError } from "#/features/settings/components/mailboxes-settings-shared";
import {
  SettingsCard,
  SettingsSection,
} from "#/features/settings/components/settings-layout";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

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
  const [displayName, setDisplayName] = useState(() => {
    const trimmed = mailbox.displayName?.trim() ?? "";
    return trimmed === "" ? "Gmail" : trimmed;
  });
  const updateDisplayNameMutation = useMutation({
    ...orpc.mail.updateGmailMailboxDisplayName.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
    },
  });
  const savedDisplayName = (() => {
    const trimmed = mailbox.displayName?.trim() ?? "";
    return trimmed === "" ? "Gmail" : trimmed;
  })();
  const isDirty = displayName.trim() !== savedDisplayName;

  return (
    <SettingsSection
      description="Choose how this mailbox appears in Quieter. Its Gmail address remains visible beneath the name."
      title="Mailbox name"
    >
      <SettingsCard>
        <form
          className="flex flex-col gap-3 p-4 @md:flex-row @md:items-center"
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
                onError: showMutationError("Could not save mailbox name."),
              }
            );
          }}
        >
          <TextFieldInput
            aria-label={`Name for ${mailbox.emailAddress}`}
            className="min-w-0 flex-1"
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
            size="sm"
            type="submit"
          >
            Save name
          </Button>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
};
