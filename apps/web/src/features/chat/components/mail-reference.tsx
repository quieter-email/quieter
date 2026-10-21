import { Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import type { ReactNode } from "react";

import { useMailboxSearchActions } from "#/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { toastError } from "#/lib/error-toast";

import type { parseMailReference } from "../domain/mail-reference";
import { useAgentWorkspace } from "../domain/workspace-context";

export const MailReference = ({
  children,
  reference,
}: {
  children: ReactNode;
  reference: NonNullable<ReturnType<typeof parseMailReference>>;
}) => {
  const setMailboxSearch = useMailboxSearchActions();
  const workspace = useAgentWorkspace();
  const subject = reference.subject || (children ?? "Open email");
  const openMessage = async () => {
    workspace?.control.cancel();
    try {
      await setMailboxSearch(
        {
          mailbox: "inbox",
          messageId: reference.messageId,
          threadId: reference.threadId ?? null,
          view: "inbox",
        },
        { replace: false }
      );
    } catch (error) {
      toastError(error, {
        boundary: "assistant-mail-reference",
        fallback: "Could not open this email. Try again.",
      });
    }
  };

  return (
    <Button
      className="max-w-full align-middle"
      onClick={() => {
        void openMessage();
      }}
      size="auto"
      title={
        reference.from
          ? `${reference.subject ?? "Email"}, ${reference.from}`
          : reference.subject
      }
      type="button"
      variant="outline"
    >
      <HugeiconsIcon aria-hidden icon={Mail01Icon} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{subject}</span>
        {reference.from ? (
          <span className="truncate text-caption text-muted-fg">
            {reference.from}
          </span>
        ) : null}
      </span>
    </Button>
  );
};
