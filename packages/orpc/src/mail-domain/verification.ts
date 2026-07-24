import type { GetEmailIdentityCommandOutput } from "@aws-sdk/client-sesv2";
import type { MailDomainCheckResult } from "@quieter/database/schema";
import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailDomain } from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";
import {
  aggregateMailDomainStatus,
  createMailDomainDnsRecords,
  createMailDomainOwnershipToken,
  getMailDomainOwnershipToken,
  MAIL_DOMAIN_STATUS_VERIFIED,
  normalizeMailDomainDnsRecords,
} from "./records";
import {
  checkMailDomainDnsRecords,
  createSesIdentityCheck,
  createSesMailFromCheck,
  defaultDnsLookup,
  ensureReceiptRule,
  getAwsRegion,
  getDkimTokens,
  getEmailIdentity,
} from "./service";

export const verifyMailDomainSetup = async (input: {
  domainId: string;
  organizationId: string;
}) => {
  const [storedDomain] = await db
    .select({
      domain: mailDomain.domain,
      id: mailDomain.id,
      mode: mailDomain.mode,
      requiredDnsRecords: mailDomain.requiredDnsRecords,
      verifiedAt: mailDomain.verifiedAt,
    })
    .from(mailDomain)
    .where(
      and(eq(mailDomain.id, input.domainId), eq(mailDomain.organizationId, input.organizationId)),
    )
    .limit(1);

  if (!storedDomain) {
    throw new ORPCError("NOT_FOUND", {
      message: "Mail domain setup was not found in the active team.",
    });
  }

  let identity: GetEmailIdentityCommandOutput;
  try {
    identity = await getEmailIdentity(storedDomain.domain);
  } catch {
    identity = { $metadata: {} };
  }

  const requiredDnsRecords = normalizeMailDomainDnsRecords(
    getMailDomainOwnershipToken(storedDomain.requiredDnsRecords) == null
      ? createMailDomainDnsRecords({
          dkimTokens: getDkimTokens(identity),
          domain: storedDomain.domain,
          mode: storedDomain.mode,
          ownershipToken: createMailDomainOwnershipToken(),
          region: getAwsRegion(),
        })
      : storedDomain.requiredDnsRecords,
  );
  let checks = [
    createSesIdentityCheck(identity),
    createSesMailFromCheck(identity),
    ...(await checkMailDomainDnsRecords(defaultDnsLookup, requiredDnsRecords)),
  ];
  const now = new Date();
  let status = aggregateMailDomainStatus(checks);

  if (status === MAIL_DOMAIN_STATUS_VERIFIED && storedDomain.mode === "send_and_receive") {
    try {
      await ensureReceiptRule(storedDomain.domain);
      checks = [
        ...checks,
        {
          expected: ["Incoming mail routing configured"],
          found: ["Incoming mail routing configured"],
          message: "Incoming mail routing is configured.",
          ok: true,
          purpose: "receipt_rule" as const,
        },
      ];
    } catch (error) {
      checks = [
        ...checks,
        {
          expected: ["Incoming mail routing configured"],
          found: [],
          message:
            error instanceof Error
              ? error.message
              : "Incoming mail routing could not be configured.",
          ok: false,
          purpose: "receipt_rule" as const,
        },
      ];
      status = aggregateMailDomainStatus(checks);
    }
  }

  const verifiedAt =
    (status === MAIL_DOMAIN_STATUS_VERIFIED && (storedDomain.verifiedAt ?? now)) || null;
  const lastCheckResult = {
    checkedAt: now.toISOString(),
    checks,
  } satisfies MailDomainCheckResult;

  await db
    .update(mailDomain)
    .set({
      lastCheckResult,
      requiredDnsRecords,
      status,
      updatedAt: now,
      verifiedAt,
    })
    .where(eq(mailDomain.id, storedDomain.id));

  return {
    checks,
    domain: storedDomain.domain,
    domainId: storedDomain.id,
    mode: storedDomain.mode,
    status,
    verifiedAt,
  };
};
