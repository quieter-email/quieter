import { db, mailDomain } from "@quieter/database";
import { and, eq } from "drizzle-orm";

export class OrganizationMailSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OrganizationMailSendError";
  }
}

const getSenderDomain = (sender: string) => {
  const domain = sender.trim().toLowerCase().split("@").at(1);

  if (!domain) {
    throw new OrganizationMailSendError("Sender must be an email address.", 400);
  }

  return domain;
};

export const assertOrganizationOwnsVerifiedSenderDomain = async (input: {
  organizationId: string;
  sender: string;
}) => {
  const domain = getSenderDomain(input.sender);
  const [ownedDomain] = await db
    .select({ id: mailDomain.id })
    .from(mailDomain)
    .where(
      and(
        eq(mailDomain.organizationId, input.organizationId),
        eq(mailDomain.domain, domain),
        eq(mailDomain.status, "verified"),
      ),
    )
    .limit(1);

  if (!ownedDomain) {
    throw new OrganizationMailSendError(
      "Sender domain is not verified for this organization.",
      403,
    );
  }

  return domain;
};
