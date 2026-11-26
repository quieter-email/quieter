import type { CallToolResult } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { reportServerError } from "./server-error-reporting";

export type TransactionalMailAccess =
  | { organizationId: string }
  | { principal: string; userId: string };

export const transactionalOrganizationIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("Explicit ID of the team to operate on.");

export const assertTransactionalTeamAccess = async (input: {
  organizationId: string;
  requireApiKeys: boolean;
  userId: string;
}) => {
  const { assertUserCanManageOrganizationSettings } =
    await import("@quieter/orpc/mail-domain");
  await assertUserCanManageOrganizationSettings(input);

  if (input.requireApiKeys) {
    const { organizationHasBillingFeature } =
      await import("@quieter/orpc/organization-mail");
    const hasAccess = await organizationHasBillingFeature({
      feature: "organizationApiKeys",
      organizationId: input.organizationId,
    });
    if (!hasAccess) {
      throw new ORPCError("FORBIDDEN", {
        message: "This team's plan does not include transactional API access.",
      });
    }
  }
};

export const transactionalToolError = (message: string): CallToolResult => ({
  content: [{ text: message, type: "text" }],
  isError: true,
});

export const runTransactionalTool = async (
  boundary: string,
  failureMessage: string,
  action: () => Promise<CallToolResult>
): Promise<CallToolResult> => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      return transactionalToolError(error.message);
    }
    if (
      error instanceof Error &&
      error.name === "OrganizationMailSendError" &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status < 500
    ) {
      return transactionalToolError(error.message);
    }
    reportServerError(error, boundary);
    return transactionalToolError(failureMessage);
  }
};
