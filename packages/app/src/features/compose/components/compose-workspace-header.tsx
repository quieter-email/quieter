import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { MailSubviewHeader } from "@quieter/app/features/mailbox/components/mail-subview-header";
import { Text } from "@quieter/ui/text";
import type { ComponentProps } from "react";

export const ComposeWorkspaceHeader = ({
  saveStatus,
  ...props
}: Pick<
  ComponentProps<typeof MailSubviewHeader>,
  "closeAction" | "onOpenSidebar"
> & {
  saveStatus?: ComposeDraftState["saveStatus"];
}) => (
  <MailSubviewHeader
    className="ps-5 pe-4 pt-4 sm:ps-8 sm:pe-6 sm:pt-6"
    title="New message"
    titleAccessory={
      <output className="shrink-0">
        <Text as="span" size="caption" tone="muted">
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "saved" && "Draft saved"}
        </Text>
      </output>
    }
    titleSize="body"
    {...props}
  />
);
