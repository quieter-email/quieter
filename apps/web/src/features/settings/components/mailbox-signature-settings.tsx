"use client";

import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Textarea } from "@quieter/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { textToComposeBodyHtml } from "#/features/compose/domain/draft";
import {
  SettingsCard,
  SettingsSection,
  settingsSurfaceVariants,
} from "#/features/settings/components/settings-layout";
import { toastError } from "#/lib/error-toast";
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
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-caption text-muted-fg">
              Leave it empty to send without a signature.
            </p>
            <ActionFooter>
              <Button
                disabled={!isDirty}
                onClick={() => {
                  updateSignatureMutation.mutate(
                    {
                      mailboxId: mailbox.id,
                      signatureHtml:
                        textToComposeBodyHtml(signatureText) || null,
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
            </ActionFooter>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
};
