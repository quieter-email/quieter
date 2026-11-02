import { ORPCError } from "@orpc/server";
import { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";

export const assertDomainBillingAccess = async (organizationId: string) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "organizationDomains",
    organizationId,
  });
  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: "Custom team domains require Team billing.",
    });
  }
};
