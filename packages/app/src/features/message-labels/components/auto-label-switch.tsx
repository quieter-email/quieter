"use client";

import {
  getDemoLabelAutomation,
  saveDemoLabelAutomation,
} from "@quieter/app/lib/demo-mail/label-automation";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  getMailboxesQueryKey,
  mailboxesQueryOptions,
} from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

export const AutoLabelSwitch = ({
  canManage,
  mailboxId,
}: {
  canManage: boolean;
  mailboxId: string;
}) => {
  const id = useId();
  const queryClient = useQueryClient();
  const isDemo = isSandboxMailboxId(mailboxId);
  const [demoEnabled, setDemoEnabled] = useState(
    () => getDemoLabelAutomation(mailboxId).enabled
  );
  const { data: mailboxes, isPending: areMailboxesPending } = useQuery(
    mailboxesQueryOptions(!isDemo)
  );
  const { isPending, mutateAsync } = useMutation(
    orpc.mail.setGmailAutoLabeling.mutationOptions()
  );
  const enabled = isDemo
    ? demoEnabled
    : (mailboxes?.groups
        .flatMap((group) => group.mailboxes)
        .find((mailbox) => mailbox.id === mailboxId)?.autoLabelEnabled ??
      false);

  const toggleAutoLabeling = async (nextEnabled: boolean) => {
    try {
      if (isDemo) {
        saveDemoLabelAutomation(mailboxId, {
          ...getDemoLabelAutomation(mailboxId),
          enabled: nextEnabled,
        });
        setDemoEnabled(nextEnabled);
      } else {
        await mutateAsync({ enabled: nextEnabled, mailboxId });
      }
      await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
    } catch (error) {
      toastError(error, {
        boundary: "auto-labeling",
        fallback: "Could not update auto-labeling. Please try again.",
      });
    }
  };

  return (
    <div className="flex items-center gap-4">
      <label className="min-w-0 flex-1 cursor-pointer" htmlFor={id}>
        <span className="block text-body text-fg">Auto-label new mail</span>
      </label>
      <Switch
        checked={enabled}
        disabled={!canManage || isPending || (!isDemo && areMailboxesPending)}
        id={id}
        onCheckedChange={(nextEnabled) => {
          void toggleAutoLabeling(nextEnabled);
        }}
        size="sm"
      >
        <SwitchThumb />
      </Switch>
    </div>
  );
};
