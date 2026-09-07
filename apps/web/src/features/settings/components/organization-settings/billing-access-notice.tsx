import { Button } from "@quieter/ui/button";
import { Link } from "@tanstack/react-router";

export const BillingAccessNotice = ({
  organizationId,
}: {
  organizationId: string;
}) => (
  <section
    className="space-y-3 rounded-lg border border-border p-4"
    aria-label="Subscription required"
  >
    <p className="text-body font-medium text-fg">
      Sending and API access are paused
    </p>
    <p className="text-body text-muted-fg">
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
  </section>
);
