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
import { cn } from "@quieter/ui/cn";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

export const AutoLabelSwitch = ({
  canManage,
  className,
  mailboxId,
}: {
  canManage: boolean;
  className?: string;
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
    <div className={cn("flex items-center gap-2", className)}>
      <label className="cursor-default truncate" htmlFor={id}>
        Auto-label new mail
      </label>
      <span className="flex w-8 shrink-0 justify-center">
        <Switch
          checked={enabled}
          disabled={!canManage || isPending || (!isDemo && areMailboxesPending)}
          id={id}
          onCheckedChange={(nextEnabled) => {
            void toggleAutoLabeling(nextEnabled);
          }}
          size="xs"
        >
          <SwitchThumb />
        </Switch>
      </span>
    </div>
  );
};
