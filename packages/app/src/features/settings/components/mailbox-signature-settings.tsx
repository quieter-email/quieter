"use client";

import { textToComposeBodyHtml } from "@quieter/app/features/compose/domain/draft";
import {
  SettingsCard,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { Button } from "@quieter/ui/button";
import { Textarea } from "@quieter/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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
        <div className={settingsSurfaceVariants({ variant: "body" })}>
          <Textarea
            aria-label={`Signature for ${mailbox.emailAddress}`}
            onChange={(event) => {
              setSignatureText(event.currentTarget.value);
            }}
            placeholder={"Your name\nYour role"}
            rows={5}
            value={signatureText}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
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
                    onError: (error) => {
                      toastError(error, {
                        boundary: "mailbox-settings",
                        fallback: "Could not save signature.",
                      });
                    },
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
