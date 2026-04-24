import {
  AlreadyExistsException as SesAlreadyExistsException,
  CreateReceiptRuleCommand,
  CreateReceiptRuleSetCommand,
  SESClient,
  SetActiveReceiptRuleSetCommand,
  UpdateReceiptRuleCommand,
} from "@aws-sdk/client-ses";
import {
  AlreadyExistsException as SesV2AlreadyExistsException,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
  type GetEmailIdentityCommandOutput,
} from "@aws-sdk/client-sesv2";
import { ORPCError } from "@orpc/server";
import {
  db,
  mailDomain,
  type MailDomainCheckResult,
  type MailDomainDnsRecord,
  type MailDomainStatus,
} from "@quieter/database";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type MailDomainCheck = MailDomainCheckResult["checks"][number];

type MxLookupRecord = {
  exchange: string;
  priority: number;
};

export type MailDomainDnsLookup = {
  resolveCname: (name: string) => Promise<string[]>;
  resolveMx: (name: string) => Promise<MxLookupRecord[]>;
  resolveTxt: (name: string) => Promise<string[][]>;
};

type ReceiptRuleConfig = {
  bucketName: string;
  roleArn: string;
  ruleSetName: string;
  topicArn: string;
};

type SstOutputs = {
  mailBucket?: string;
  mailReceiptRoleArn?: string;
  mailReceiptRuleSetName?: string;
  mailReceiptTopicArn?: string;
};

const MAIL_DOMAIN_STATUS_PENDING = "pending_dns" satisfies MailDomainStatus;
const MAIL_DOMAIN_STATUS_VERIFIED = "verified" satisfies MailDomainStatus;
const MAIL_DOMAIN_STATUS_FAILED = "failed" satisfies MailDomainStatus;
const MAIL_FROM_PREFIX = "bounce";
const MAIL_OBJECT_KEY_PREFIX = "mail/inbound/";
const DEFAULT_RECEIPT_RULE_SET_NAME = "quieter-mail";
const DMARC_RECORD_PREFIX = "v=DMARC1; p=none";

let sesClient: SESClient | null = null;
let sesv2Client: SESv2Client | null = null;
let sstOutputs: SstOutputs | null | undefined;

const defaultDnsLookup = {
  resolveCname,
  resolveMx,
  resolveTxt,
} satisfies MailDomainDnsLookup;

const getAwsRegion = () => {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();

  if (!region) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "AWS_REGION or AWS_DEFAULT_REGION is required for mail domain setup.",
    });
  }

  return region;
};

const getSesClient = () => {
  sesClient ??= new SESClient({ region: getAwsRegion() });
  return sesClient;
};

const getSesv2Client = () => {
  sesv2Client ??= new SESv2Client({ region: getAwsRegion() });
  return sesv2Client;
};

const toLookupName = (name: string) => name.replace(/\.$/, "").toLowerCase();

const normalizeDnsValue = (value: string) => value.replace(/\.$/, "").toLowerCase();

const isAwsAlreadyExistsError = (error: unknown) =>
  error instanceof SesAlreadyExistsException ||
  error instanceof SesV2AlreadyExistsException ||
  (typeof error === "object" &&
    error != null &&
    "name" in error &&
    (error.name === "AlreadyExistsException" || error.name === "AlreadyExists"));

export const normalizeMailDomain = (input: string) => {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Domain is required.",
    });
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let hostname: string;

  try {
    hostname = new URL(withProtocol).hostname;
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "Enter a valid domain.",
    });
  }

  const domain = hostname.toLowerCase().replace(/\.$/, "");
  const labels = domain.split(".");
  const isValid =
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

  if (!isValid) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Enter a valid domain.",
    });
  }

  return domain;
};

export const createMailDomainDnsRecords = (input: {
  dkimTokens: string[];
  domain: string;
  region: string;
}): MailDomainDnsRecord[] => {
  const mailFromDomain = `${MAIL_FROM_PREFIX}.${input.domain}`;

  return [
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

export const aggregateMailDomainStatus = (checks: MailDomainCheck[]): MailDomainStatus =>
  checks.every((check) => check.ok) ? MAIL_DOMAIN_STATUS_VERIFIED : MAIL_DOMAIN_STATUS_FAILED;

const ensureExplicitOrganization = (organizationId: string | null) => {
  if (!organizationId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Managed mail domains belong to an organization.",
    });
  }

  return organizationId;
};

const getEmailIdentity = async (domain: string) =>
  await getSesv2Client().send(new GetEmailIdentityCommand({ EmailIdentity: domain }));

const createOrLoadEmailIdentity = async (domain: string) => {
  try {
    return await getSesv2Client().send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
  } catch (error) {
    if (!isAwsAlreadyExistsError(error)) {
      throw error;
    }

    return await getEmailIdentity(domain);
  }
};

const ensureMailFromDomain = async (input: { domain: string; mailFromDomain: string }) => {
  await getSesv2Client().send(
    new PutEmailIdentityMailFromAttributesCommand({
      BehaviorOnMxFailure: "REJECT_MESSAGE",
      EmailIdentity: input.domain,
      MailFromDomain: input.mailFromDomain,
    }),
  );
};

const getDkimTokens = (identity: GetEmailIdentityCommandOutput) => {
  const tokens = identity.DkimAttributes?.Tokens?.filter(Boolean) ?? [];

  if (tokens.length === 0) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "SES did not return DKIM records for this domain.",
    });
  }

  return tokens;
};

const isSesIdentityVerified = (identity: GetEmailIdentityCommandOutput) =>
  identity.VerifiedForSendingStatus === true && identity.DkimAttributes?.Status === "SUCCESS";

const loadSstOutputs = async (): Promise<SstOutputs | null> => {
  if (sstOutputs !== undefined) {
    return sstOutputs;
  }

  try {
    const raw = await readFile(join(process.cwd(), ".sst", "outputs.json"), "utf8");
    sstOutputs = JSON.parse(raw) as SstOutputs;
  } catch {
    sstOutputs = null;
  }

  return sstOutputs;
};

const getReceiptRuleConfig = async (): Promise<ReceiptRuleConfig> => {
  const outputs = await loadSstOutputs();
  const bucketName = process.env.MAIL_BUCKET?.trim() || outputs?.mailBucket?.trim();
  const topicArn =
    process.env.MAIL_RECEIPT_TOPIC_ARN?.trim() || outputs?.mailReceiptTopicArn?.trim();
  const roleArn = process.env.MAIL_RECEIPT_ROLE_ARN?.trim() || outputs?.mailReceiptRoleArn?.trim();
  const ruleSetName =
    process.env.MAIL_RECEIPT_RULE_SET_NAME?.trim() ||
    outputs?.mailReceiptRuleSetName?.trim() ||
    DEFAULT_RECEIPT_RULE_SET_NAME;

  if (!bucketName || !topicArn || !roleArn) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message:
        "Mail receipt rule configuration is missing. Set MAIL_BUCKET, MAIL_RECEIPT_TOPIC_ARN, and MAIL_RECEIPT_ROLE_ARN.",
    });
  }

  return {
    bucketName,
    roleArn,
    ruleSetName,
    topicArn,
  };
};

const createReceiptRuleName = (domain: string) => {
  const slug = domain.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  const hash = createHash("sha256").update(domain).digest("hex").slice(0, 12);

  return `quieter-${slug.slice(0, 40)}-${hash}`;
};

const ensureReceiptRule = async (domain: string) => {
  const config = await getReceiptRuleConfig();
  const rule = {
    Actions: [
      {
        S3Action: {
          BucketName: config.bucketName,
          IAMRoleARN: config.roleArn,
          ObjectKeyPrefix: MAIL_OBJECT_KEY_PREFIX,
          TopicArn: config.topicArn,
        },
      },
    ],
    Enabled: true,
    Name: createReceiptRuleName(domain),
    Recipients: [domain],
    ScanEnabled: true,
    TlsPolicy: "Optional" as const,
  };

  try {
    await getSesClient().send(new CreateReceiptRuleSetCommand({ RuleSetName: config.ruleSetName }));
  } catch (error) {
    if (!isAwsAlreadyExistsError(error)) {
      throw error;
    }
  }

  await getSesClient().send(
    new SetActiveReceiptRuleSetCommand({ RuleSetName: config.ruleSetName }),
  );

  try {
    await getSesClient().send(
      new CreateReceiptRuleCommand({
        Rule: rule,
        RuleSetName: config.ruleSetName,
      }),
    );
  } catch (error) {
    if (!isAwsAlreadyExistsError(error)) {
      throw error;
    }

    await getSesClient().send(
      new UpdateReceiptRuleCommand({
        Rule: rule,
        RuleSetName: config.ruleSetName,
      }),
    );
  }
};

const checkCnameRecord = async (
  dns: MailDomainDnsLookup,
  record: MailDomainDnsRecord,
): Promise<MailDomainCheck> => {
  const expected = [normalizeDnsValue(record.value)];
  let found: string[] = [];

  try {
    found = (await dns.resolveCname(toLookupName(record.name))).map(normalizeDnsValue);
  } catch {
    found = [];
  }

  const ok = found.some((value) => expected.includes(value));

  return {
    expected,
    found,
    message: ok ? "DKIM CNAME record is present." : "DKIM CNAME record is missing.",
    ok,
    purpose: "dkim",
  };
};

const checkMxRecord = async (
  dns: MailDomainDnsLookup,
  record: MailDomainDnsRecord,
): Promise<MailDomainCheck> => {
  const expected = [`${record.priority ?? 10} ${normalizeDnsValue(record.value)}`];
  let foundRecords: MxLookupRecord[] = [];

  try {
    foundRecords = await dns.resolveMx(toLookupName(record.name));
  } catch {
    foundRecords = [];
  }

  const found = foundRecords.map(
    (mxRecord) => `${mxRecord.priority} ${normalizeDnsValue(mxRecord.exchange)}`,
  );
  const ok = found.some((value) => expected.includes(value));

  return {
    expected,
    found,
    message: ok ? "MX record is present." : "MX record is missing.",
    ok,
    purpose: record.purpose,
  };
};

const checkTxtRecord = async (
  dns: MailDomainDnsLookup,
  record: MailDomainDnsRecord,
): Promise<MailDomainCheck> => {
  const expected = [record.value.toLowerCase()];
  let found: string[] = [];

  try {
    found = (await dns.resolveTxt(toLookupName(record.name))).map((chunks) =>
      chunks.join("").toLowerCase(),
    );
  } catch {
    found = [];
  }

  const ok =
    record.purpose === "dmarc"
      ? found.some((value) => value.startsWith(DMARC_RECORD_PREFIX.toLowerCase()))
      : found.some((value) => expected.includes(value));

  return {
    expected,
    found,
    message: ok ? "TXT record is present." : "TXT record is missing.",
    ok,
    purpose: record.purpose,
  };
};

export const checkMailDomainDnsRecords = async (
  dns: MailDomainDnsLookup,
  records: MailDomainDnsRecord[],
): Promise<MailDomainCheck[]> =>
  await Promise.all(
    records.map((record) => {
      if (record.type === "CNAME") {
        return checkCnameRecord(dns, record);
      }

      if (record.type === "MX") {
        return checkMxRecord(dns, record);
      }

      return checkTxtRecord(dns, record);
    }),
  );

const createSesIdentityCheck = (identity: GetEmailIdentityCommandOutput): MailDomainCheck => {
  const verified = isSesIdentityVerified(identity);
  const status = identity.DkimAttributes?.Status ?? "UNKNOWN";

  return {
    expected: ["VerifiedForSendingStatus=true", "DkimAttributes.Status=SUCCESS"],
    found: [
      `VerifiedForSendingStatus=${String(identity.VerifiedForSendingStatus)}`,
      `DkimAttributes.Status=${status}`,
    ],
    message: verified ? "SES identity is verified." : "SES identity is not verified yet.",
    ok: verified,
    purpose: "ses_identity",
  };
};

const createSesMailFromCheck = (identity: GetEmailIdentityCommandOutput): MailDomainCheck => {
  const status = identity.MailFromAttributes?.MailFromDomainStatus ?? "UNKNOWN";
  const ok = status === "SUCCESS";

  return {
    expected: ["MailFromDomainStatus=SUCCESS"],
    found: [`MailFromDomainStatus=${status}`],
    message: ok ? "SES custom MAIL FROM is verified." : "SES custom MAIL FROM is not verified yet.",
    ok,
    purpose: "ses_mail_from",
  };
};

export const createMailDomainSetup = async (input: {
  activeOrganizationId: string | null;
  domain: string;
}) => {
  const organizationId = ensureExplicitOrganization(input.activeOrganizationId);
  const domain = normalizeMailDomain(input.domain);
  const region = getAwsRegion();
  const mailFromDomain = `${MAIL_FROM_PREFIX}.${domain}`;
  const createdIdentity = await createOrLoadEmailIdentity(domain);

  await ensureMailFromDomain({ domain, mailFromDomain });

  const identity =
    (createdIdentity.DkimAttributes?.Tokens?.length ?? 0) === 0
      ? await getEmailIdentity(domain)
      : createdIdentity;
  const records = createMailDomainDnsRecords({
    dkimTokens: getDkimTokens(identity),
    domain,
    region,
  });
  const status = isSesIdentityVerified(identity)
    ? MAIL_DOMAIN_STATUS_VERIFIED
    : MAIL_DOMAIN_STATUS_PENDING;
  const now = new Date();
  const verifiedAt = status === MAIL_DOMAIN_STATUS_VERIFIED ? now : null;
  const [existingDomain] = await db
    .select({ id: mailDomain.id, createdAt: mailDomain.createdAt })
    .from(mailDomain)
    .where(and(eq(mailDomain.organizationId, organizationId), eq(mailDomain.domain, domain)))
    .limit(1);

  if (existingDomain) {
    const [updatedDomain] = await db
      .update(mailDomain)
      .set({
        mailFromDomain,
        requiredDnsRecords: records,
        status,
        updatedAt: now,
        verifiedAt,
      })
      .where(eq(mailDomain.id, existingDomain.id))
      .returning({
        id: mailDomain.id,
        status: mailDomain.status,
      });

    return {
      domain,
      domainId: updatedDomain?.id ?? existingDomain.id,
      records,
      status: updatedDomain?.status ?? status,
    };
  }

  const id = crypto.randomUUID();
  const [createdDomain] = await db
    .insert(mailDomain)
    .values({
      createdAt: now,
      domain,
      id,
      lastCheckResult: null,
      mailFromDomain,
      organizationId,
      requiredDnsRecords: records,
      status,
      updatedAt: now,
      verifiedAt,
    })
    .returning({
      id: mailDomain.id,
      status: mailDomain.status,
    });

  return {
    domain,
    domainId: createdDomain?.id ?? id,
    records,
    status: createdDomain?.status ?? status,
  };
};

export const checkMailDomainSetup = async (input: {
  activeOrganizationId: string | null;
  dnsLookup?: MailDomainDnsLookup;
  domain: string;
}) => {
  const organizationId = ensureExplicitOrganization(input.activeOrganizationId);
  const domain = normalizeMailDomain(input.domain);
  const [storedDomain] = await db
    .select({
      id: mailDomain.id,
      requiredDnsRecords: mailDomain.requiredDnsRecords,
      verifiedAt: mailDomain.verifiedAt,
    })
    .from(mailDomain)
    .where(and(eq(mailDomain.organizationId, organizationId), eq(mailDomain.domain, domain)))
    .limit(1);

  if (!storedDomain) {
    throw new ORPCError("NOT_FOUND", {
      message: "Mail domain setup was not found in the active organization.",
    });
  }

  let identity: GetEmailIdentityCommandOutput;

  try {
    identity = await getEmailIdentity(domain);
  } catch {
    identity = { $metadata: {} };
  }

  const checks = [
    createSesIdentityCheck(identity),
    createSesMailFromCheck(identity),
    ...(await checkMailDomainDnsRecords(
      input.dnsLookup ?? defaultDnsLookup,
      storedDomain.requiredDnsRecords,
    )),
  ];
  const status = aggregateMailDomainStatus(checks);
  const now = new Date();
  const verifiedAt =
    status === MAIL_DOMAIN_STATUS_VERIFIED ? (storedDomain.verifiedAt ?? now) : null;
  const lastCheckResult = {
    checkedAt: now.toISOString(),
    checks,
  } satisfies MailDomainCheckResult;

  if (status === MAIL_DOMAIN_STATUS_VERIFIED) {
    await ensureReceiptRule(domain);
  }

  await db
    .update(mailDomain)
    .set({
      lastCheckResult,
      status,
      updatedAt: now,
      verifiedAt,
    })
    .where(eq(mailDomain.id, storedDomain.id));

  return {
    checks,
    domain,
    domainId: storedDomain.id,
    status,
    verifiedAt,
  };
};
