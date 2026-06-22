import type { SESClient } from "@aws-sdk/client-ses";
import type { SESv2Client, GetEmailIdentityCommandOutput } from "@aws-sdk/client-sesv2";
import { ORPCError } from "@orpc/server";
import { db, member, type MailDomainDnsRecord } from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DMARC_RECORD_PREFIX, type MailDomainCheck } from "./records";

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

const MAIL_OBJECT_KEY_PREFIX = "mail/inbound/";
const DEFAULT_RECEIPT_RULE_SET_NAME = "quieter-mail";

let sesClient: SESClient | null = null;
let sesv2Client: SESv2Client | null = null;
let sstOutputs: SstOutputs | null | undefined;

export const defaultDnsLookup = {
  resolveCname,
  resolveMx,
  resolveTxt,
} satisfies MailDomainDnsLookup;

export const getAwsRegion = () => {
  const region = serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION;

  if (!region) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Mail domain setup is temporarily unavailable.",
    });
  }

  return region;
};

const getSesClient = async (): Promise<SESClient> => {
  const { SESClient } = await import("@aws-sdk/client-ses");
  sesClient ??= new SESClient({ region: getAwsRegion() });
  return sesClient;
};

const getSesv2Client = async (): Promise<SESv2Client> => {
  const { SESv2Client } = await import("@aws-sdk/client-sesv2");
  sesv2Client ??= new SESv2Client({ region: getAwsRegion() });
  return sesv2Client;
};

const toLookupName = (name: string) => name.replace(/\.$/, "").toLowerCase();

const normalizeDnsValue = (value: string) => value.replace(/\.$/, "").toLowerCase();

const isAwsAlreadyExistsError = (error: unknown) =>
  typeof error === "object" &&
  error != null &&
  "name" in error &&
  (error.name === "AlreadyExistsException" || error.name === "AlreadyExists");

const isAwsNotFoundError = (error: unknown) =>
  typeof error === "object" &&
  error != null &&
  "name" in error &&
  (error.name === "NotFoundException" ||
    error.name === "NotFound" ||
    error.name === "RuleDoesNotExist");

export const assertUserOrganizationMember = async (input: {
  organizationId: string;
  userId: string;
}) => {
  const [membership] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
    .limit(1);

  if (!membership) {
    throw new ORPCError("NOT_FOUND", {
      message: "Team not found.",
    });
  }

  return membership;
};

const hasOrganizationManagerRole = (role: string) =>
  role
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === "admin" || part === "owner");

export const assertUserCanManageMailDomains = async (input: {
  organizationId: string;
  userId: string;
}) => {
  const membership = await assertUserOrganizationMember(input);

  if (!hasOrganizationManagerRole(membership.role)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only admins and owners can manage team domains.",
    });
  }
};

export const assertUserCanManageOrganizationSettings = async (input: {
  organizationId: string;
  userId: string;
}) => {
  const membership = await assertUserOrganizationMember(input);

  if (!hasOrganizationManagerRole(membership.role)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only admins and owners can manage team settings.",
    });
  }
};

export const getEmailIdentity = async (domain: string) => {
  const { GetEmailIdentityCommand } = await import("@aws-sdk/client-sesv2");
  const client = await getSesv2Client();
  return await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
};

export const createOrLoadEmailIdentity = async (domain: string) => {
  try {
    const { CreateEmailIdentityCommand } = await import("@aws-sdk/client-sesv2");
    const client = await getSesv2Client();
    return await client.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
  } catch (error) {
    if (!isAwsAlreadyExistsError(error)) {
      throw error;
    }

    return await getEmailIdentity(domain);
  }
};

export const ensureMailFromDomain = async (input: { domain: string; mailFromDomain: string }) => {
  const { PutEmailIdentityMailFromAttributesCommand } = await import("@aws-sdk/client-sesv2");
  const client = await getSesv2Client();
  await client.send(
    new PutEmailIdentityMailFromAttributesCommand({
      BehaviorOnMxFailure: "REJECT_MESSAGE",
      EmailIdentity: input.domain,
      MailFromDomain: input.mailFromDomain,
    }),
  );
};

export const getDkimTokens = (identity: GetEmailIdentityCommandOutput) => {
  const tokens = identity.DkimAttributes?.Tokens?.filter(Boolean) ?? [];

  if (tokens.length === 0) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Could not prepare the required domain records.",
    });
  }

  return tokens;
};

export const isSesIdentityVerified = (identity: GetEmailIdentityCommandOutput) =>
  identity.VerifiedForSendingStatus === true && identity.DkimAttributes?.Status === "SUCCESS";

const getSstOutputPaths = () =>
  Array.from(
    new Set(
      [
        join(process.cwd(), ".sst", "outputs.json"),
        join(process.cwd(), "..", "..", ".sst", "outputs.json"),
        join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".sst", "outputs.json"),
      ].map((path) => resolve(path)),
    ),
  );

const loadSstOutputs = async (): Promise<SstOutputs | null> => {
  if (sstOutputs !== undefined) {
    return sstOutputs;
  }

  for (const path of getSstOutputPaths()) {
    try {
      const raw = await readFile(path, "utf8");
      sstOutputs = JSON.parse(raw) as SstOutputs;
      return sstOutputs;
    } catch {
      continue;
    }
  }

  sstOutputs = null;
  return sstOutputs;
};

const getReceiptRuleConfig = async (): Promise<ReceiptRuleConfig> => {
  const outputs = await loadSstOutputs();
  const bucketName = serverEnv.MAIL_BUCKET || outputs?.mailBucket?.trim();
  const topicArn = serverEnv.MAIL_RECEIPT_TOPIC_ARN || outputs?.mailReceiptTopicArn?.trim();
  const roleArn = serverEnv.MAIL_RECEIPT_ROLE_ARN || outputs?.mailReceiptRoleArn?.trim();
  const ruleSetName =
    serverEnv.MAIL_RECEIPT_RULE_SET_NAME ||
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

export const ensureReceiptRule = async (domain: string) => {
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

  const {
    CreateReceiptRuleSetCommand,
    SetActiveReceiptRuleSetCommand,
    CreateReceiptRuleCommand,
    UpdateReceiptRuleCommand,
  } = await import("@aws-sdk/client-ses");
  const client = await getSesClient();

  try {
    await client.send(new CreateReceiptRuleSetCommand({ RuleSetName: config.ruleSetName }));
  } catch (error) {
    if (!isAwsAlreadyExistsError(error)) {
      throw error;
    }
  }

  await client.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: config.ruleSetName }));

  try {
    await client.send(
      new CreateReceiptRuleCommand({
        Rule: rule,
        RuleSetName: config.ruleSetName,
      }),
    );
  } catch (error) {
    if (!isAwsAlreadyExistsError(error)) {
      throw error;
    }

    await client.send(
      new UpdateReceiptRuleCommand({
        Rule: rule,
        RuleSetName: config.ruleSetName,
      }),
    );
  }
};

export const deleteMailDomainAwsResources = async (domain: string) => {
  let cleanupSucceeded = true;

  try {
    const config = await getReceiptRuleConfig();

    const { DeleteReceiptRuleCommand } = await import("@aws-sdk/client-ses");
    const client = await getSesClient();

    await client.send(
      new DeleteReceiptRuleCommand({
        RuleName: createReceiptRuleName(domain),
        RuleSetName: config.ruleSetName,
      }),
    );
  } catch (error) {
    cleanupSucceeded = cleanupSucceeded && isAwsNotFoundError(error);
  }

  try {
    const { DeleteEmailIdentityCommand } = await import("@aws-sdk/client-sesv2");
    const client = await getSesv2Client();
    await client.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }));
  } catch (error) {
    cleanupSucceeded = cleanupSucceeded && isAwsNotFoundError(error);
  }

  return cleanupSucceeded;
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
  const recordLabel = record.purpose === "ownership" ? "Ownership TXT" : "TXT";

  return {
    expected,
    found,
    message: ok ? `${recordLabel} record is present.` : `${recordLabel} record is missing.`,
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

export const createSesIdentityCheck = (
  identity: GetEmailIdentityCommandOutput,
): MailDomainCheck => {
  const verified = isSesIdentityVerified(identity);
  const status = identity.DkimAttributes?.Status ?? "UNKNOWN";

  return {
    expected: ["VerifiedForSendingStatus=true", "DkimAttributes.Status=SUCCESS"],
    found: [
      `VerifiedForSendingStatus=${String(identity.VerifiedForSendingStatus)}`,
      `DkimAttributes.Status=${status}`,
    ],
    message: verified ? "Sending identity is verified." : "Sending identity is not verified yet.",
    ok: verified,
    purpose: "ses_identity",
  };
};

export const createSesMailFromCheck = (
  identity: GetEmailIdentityCommandOutput,
): MailDomainCheck => {
  const status = identity.MailFromAttributes?.MailFromDomainStatus ?? "UNKNOWN";
  const ok = status === "SUCCESS";

  return {
    expected: ["MailFromDomainStatus=SUCCESS"],
    found: [`MailFromDomainStatus=${status}`],
    message: ok ? "Custom MAIL FROM is verified." : "Custom MAIL FROM is not verified yet.",
    ok,
    purpose: "ses_mail_from",
  };
};
