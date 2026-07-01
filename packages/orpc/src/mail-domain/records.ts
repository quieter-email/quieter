import type {
  MailDomainCheckResult,
  MailDomainDnsRecord,
  MailDomainStatus,
} from "@quieter/database/schema";
import { ORPCError } from "@orpc/server";
import { randomBytes } from "node:crypto";

export type MailDomainCheck = MailDomainCheckResult["checks"][number];

export const MAIL_DOMAIN_STATUS_VERIFIED = "verified" satisfies MailDomainStatus;
const MAIL_DOMAIN_STATUS_FAILED = "failed" satisfies MailDomainStatus;
const MAIL_FROM_PREFIX = "bounce";
const OWNERSHIP_RECORD_PREFIX = "quieter-domain-verification=";
export const DMARC_RECORD_PREFIX = "v=DMARC1; p=none";

export const normalizeMailDomain = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) throw new ORPCError("BAD_REQUEST", { message: "Domain is required." });

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let hostname: string;
  try {
    hostname = new URL(withProtocol).hostname;
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Enter a valid domain." });
  }

  const domain = hostname.toLowerCase().replace(/\.$/, "");
  const labels = domain.split(".");
  const valid =
    domain.length <= 253 &&
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9-]+$/.test(label) &&
        !label.startsWith("-") &&
        !label.endsWith("-"),
    ) &&
    /^[a-z]{2,}$/.test(labels.at(-1) ?? "");
  if (!valid) throw new ORPCError("BAD_REQUEST", { message: "Enter a valid domain." });
  return domain;
};

export const createMailDomainDnsRecords = (input: {
  dkimTokens: string[];
  domain: string;
  ownershipToken: string;
  region: string;
}): MailDomainDnsRecord[] => {
  const mailFromDomain = `${MAIL_FROM_PREFIX}.${input.domain}`;
  return [
    {
      name: `_quieter-verify.${input.domain}`,
      purpose: "ownership",
      required: true,
      type: "TXT",
      value: `${OWNERSHIP_RECORD_PREFIX}${input.ownershipToken}`,
    },
    ...input.dkimTokens.map((token) => ({
      name: `${token}._domainkey.${input.domain}`,
      purpose: "dkim" as const,
      required: true as const,
      type: "CNAME" as const,
      value: `${token}.dkim.amazonses.com`,
    })),
    {
      name: mailFromDomain,
      priority: 10,
      purpose: "mail_from_mx",
      required: true,
      type: "MX",
      value: `feedback-smtp.${input.region}.amazonses.com`,
    },
    {
      name: mailFromDomain,
      purpose: "mail_from_spf",
      required: true,
      type: "TXT",
      value: "v=spf1 include:amazonses.com -all",
    },
    {
      name: input.domain,
      priority: 10,
      purpose: "inbound_mx",
      required: true,
      type: "MX",
      value: `inbound-smtp.${input.region}.amazonaws.com`,
    },
    {
      name: `_dmarc.${input.domain}`,
      purpose: "dmarc",
      required: true,
      type: "TXT",
      value: DMARC_RECORD_PREFIX,
    },
  ];
};

export const createMailDomainOwnershipToken = () => randomBytes(24).toString("base64url");

export const getMailDomainOwnershipToken = (records: MailDomainDnsRecord[]) => {
  const record = records.find(
    (candidate) =>
      candidate.purpose === "ownership" && candidate.value.startsWith(OWNERSHIP_RECORD_PREFIX),
  );
  return record?.value.slice(OWNERSHIP_RECORD_PREFIX.length) ?? null;
};

export const aggregateMailDomainStatus = (checks: MailDomainCheck[]): MailDomainStatus =>
  checks.every((check) => check.ok) ? MAIL_DOMAIN_STATUS_VERIFIED : MAIL_DOMAIN_STATUS_FAILED;
