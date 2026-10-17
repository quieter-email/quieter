import { Button } from "@quieter/ui/button";
import { Link } from "@tanstack/react-router";

import { SettingsCard, settingsSurfaceVariants } from "../settings-layout";

export const BillingAccessNotice = ({
  organizationId,
}: {
  organizationId: string;
}) => (
  <SettingsCard className={settingsSurfaceVariants({ variant: "body" })}>
    <p className={settingsSurfaceVariants({ variant: "title" })}>
      Sending and API access are paused
    </p>
    <p className={settingsSurfaceVariants({ variant: "value" })}>
      This team needs an active subscription. Your domains, keys, and existing
      mail are kept. Incoming mail continues for configured inboxes. You can
      remove domains and keys below.
    </p>
    <Button
      render={
        <Link
          to="/settings"
          search={{
            organizationId,
            organizationView: "billing",
            tab: "organization",
          }}
        />
      }
      size="sm"
      variant="outline"
    >
      View billing
    </Button>
  </SettingsCard>
);
