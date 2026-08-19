"use client";

import { Button } from "@quieter/ui/button";
import { Textarea } from "@quieter/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { textToComposeBodyHtml } from "#/features/compose/domain/draft";
import { showMutationError } from "#/features/settings/components/mailboxes-settings-shared";
import {
  SettingsCard,
  SettingsSection,
} from "#/features/settings/components/settings-layout";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

export const MailboxSignatureSettings = ({
  mailbox,
}: {
  mailbox: {
    emailAddress: string;
    id: string;
    signatureText?: string | null;
  };
}) => {
  const queryClient = useQueryClient();
  const [signatureText, setSignatureText] = useState(
    mailbox.signatureText ?? ""
  );
  const updateSignatureMutation = useMutation({
    ...orpc.mail.updateMailboxSignature.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
    },
  });
  const isDirty = signatureText.trim() !== (mailbox.signatureText ?? "").trim();

  return (
    <SettingsSection
      description="Add a reusable footer to new messages, replies, and forwards from this mailbox."
      title="Signature"
    >
      <SettingsCard>
        <div className="space-y-3 p-4">
          <Textarea
            aria-label={`Signature for ${mailbox.emailAddress}`}
            onChange={(event) => {
              setSignatureText(event.currentTarget.value);
            }}
            placeholder={"Your name\nYour role"}
            rows={5}
            value={signatureText}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-caption text-muted-fg">
              Leave it empty to send without a signature.
            </p>
            <Button
              disabled={!isDirty}
              onClick={() => {
                updateSignatureMutation.mutate(
                  {
                    mailboxId: mailbox.id,
                    signatureHtml: textToComposeBodyHtml(signatureText) || null,
                    signatureText: signatureText.trim() || null,
                  },
                  {
                    onError: showMutationError("Could not save signature."),
                  }
                );
              }}
              pending={updateSignatureMutation.isPending}
              pendingLabel="Saving…"
              size="sm"
              type="button"
            >
              Save signature
            </Button>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
};
