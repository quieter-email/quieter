import {
  CreateReceiptRuleCommand,
  CreateReceiptRuleSetCommand,
  DescribeReceiptRuleCommand,
  SESClient,
  SetActiveReceiptRuleSetCommand,
  UpdateReceiptRuleCommand,
} from "@aws-sdk/client-ses";
import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
  SendEmailCommand,
  type GetEmailIdentityCommandOutput,
} from "@aws-sdk/client-sesv2";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findMailDomainByDomain,
  listMailDomainsForOrganization,
  upsertMailDomain,
} from "./mail-service";

type MailStackOutputs = {
  mailBucket?: string;
  mailIngressUrl?: string;
  mailOutboundUrl?: string;
  mailReceiptRoleArn?: string;
  mailReceiptRuleSetName?: string;
  mailReceiptTopicArn?: string;
  stage?: string;
};

export type MailDnsRecord = {
  name: string;
  priority?: number;
  purpose: string;
  type: "CNAME" | "MX" | "TXT";
  value: string;
};

export type MailDomainSetup = {
  awsRegion: string;
  dkimStatus: string | null;
  dnsRecords: MailDnsRecord[];
  domain: string;
  domainId: string;
  inboundReady: boolean;
  inboundS3Bucket: string;
  ingressUrl: string | null;
  isActive: boolean;
  mailFromDomain: string;
  mailFromStatus: string | null;
  outboundReady: boolean;
  outboundUrl: string | null;
  receiptRuleName: string;
  receiptRuleSetName: string;
  s3Bucket: string;
  verificationStatus: string | null;
  verifiedForSendingStatus: boolean;
};

const MAIL_RECEIPT_RULE_SET_NAME = "quietr-mail";
const MAIL_FROM_SUBDOMAIN_LABEL = "bounce";

let sesClient: SESClient | null = null;
let sesv2Client: SESv2Client | null = null;
let cachedOutputs: MailStackOutputs | null | undefined;

const readConfiguredEnv = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
};

const outputsFilePaths = () =>
  Array.from(
    new Set(
      [
        readConfiguredEnv("MAIL_STACK_OUTPUTS_FILE"),
        resolve(process.cwd(), ".sst/outputs.json"),
        resolve(process.cwd(), "../.sst/outputs.json"),
        resolve(process.cwd(), "../../.sst/outputs.json"),
        resolve(dirname(fileURLToPath(import.meta.url)), "../../../.sst/outputs.json"),
      ].filter((value): value is string => Boolean(value)),
    ),
  );

const isNotFoundError = (error: unknown) =>
  error instanceof Error &&
  [
    "NotFound",
    "NotFoundException",
    "RuleDoesNotExist",
    "RuleDoesNotExistException",
    "RuleSetDoesNotExist",
    "RuleSetDoesNotExistException",
  ].includes(error.name);

const getMailAwsRegion = () => {
  const region = readConfiguredEnv("AWS_REGION", "AWS_DEFAULT_REGION");

  if (!region) {
    throw new Error("AWS_REGION environment variable is missing.");
  }

  return region;
};

const getSesClient = () => {
  sesClient ??= new SESClient({
    region: getMailAwsRegion(),
  });

  return sesClient;
};

const getSesv2Client = () => {
  sesv2Client ??= new SESv2Client({
    region: getMailAwsRegion(),
  });

  return sesv2Client;
};

const loadMailStackOutputs = async () => {
  if (cachedOutputs !== undefined) {
    return cachedOutputs;
  }

  for (const filePath of outputsFilePaths()) {
    try {
      const file = await readFile(filePath, "utf8");
      cachedOutputs = JSON.parse(file) as MailStackOutputs;
      return cachedOutputs;
    } catch {}
  }

  cachedOutputs = null;
  return cachedOutputs;
};

const readMailStackValue = async (envNames: string[], outputName: keyof MailStackOutputs) => {
  const envValue = readConfiguredEnv(...envNames);

  if (envValue) {
    return envValue;
  }

  const outputs = await loadMailStackOutputs();
  const outputValue = outputs?.[outputName];

  return typeof outputValue === "string" && outputValue.trim() ? outputValue.trim() : null;
};

const getReceiptRuleSetName = async () =>
  (await readMailStackValue(["MAIL_RECEIPT_RULE_SET_NAME"], "mailReceiptRuleSetName")) ||
  MAIL_RECEIPT_RULE_SET_NAME;

const getReceiptRoleArn = async () => {
  const roleArn = await readMailStackValue(["MAIL_RECEIPT_ROLE_ARN"], "mailReceiptRoleArn");

  if (!roleArn) {
    throw new Error("MAIL_RECEIPT_ROLE_ARN environment variable is missing.");
  }

  return roleArn;
};

const getReceiptTopicArn = async () => {
  const topicArn = await readMailStackValue(["MAIL_RECEIPT_TOPIC_ARN"], "mailReceiptTopicArn");

  if (!topicArn) {
    throw new Error("MAIL_RECEIPT_TOPIC_ARN environment variable is missing.");
  }

  return topicArn;
};

const getMailIngressUrl = async () =>
  await readMailStackValue(["MAIL_INGRESS_URL"], "mailIngressUrl");

const getMailOutboundUrl = async () =>
  await readMailStackValue(["MAIL_OUTBOUND_URL"], "mailOutboundUrl");

const toMailFromDomain = (domain: string) => `${MAIL_FROM_SUBDOMAIN_LABEL}.${domain}`;

const toInboundMxValue = (region: string) => `10 inbound-smtp.${region}.amazonaws.com`;

const toMailFromMxValue = (region: string) => `10 feedback-smtp.${region}.amazonses.com`;

const toMailFromTxtValue = () => '"v=spf1 include:amazonses.com ~all"';

const toReceiptRuleName = (domain: string) => {
  const normalizedDomain = domain.toLowerCase();
  const digest = createHash("sha1").update(normalizedDomain).digest("hex").slice(0, 12);
  const prefix = normalizedDomain
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);

  return `quietr-${prefix || "mail"}-${digest}`;
};

const ensureIdentity = async (domain: string) => {
  const client = getSesv2Client();

  try {
    return await client.send(
      new GetEmailIdentityCommand({
        EmailIdentity: domain,
      }),
    );
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await client.send(
    new CreateEmailIdentityCommand({
      EmailIdentity: domain,
    }),
  );

  return await client.send(
    new GetEmailIdentityCommand({
      EmailIdentity: domain,
    }),
  );
};

const ensureMailFromAttributes = async (domain: string) => {
  await getSesv2Client().send(
    new PutEmailIdentityMailFromAttributesCommand({
      BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
      EmailIdentity: domain,
      MailFromDomain: toMailFromDomain(domain),
    }),
  );
};

const ensureReceiptRuleSet = async () => {
  const ruleSetName = await getReceiptRuleSetName();

  try {
    await getSesClient().send(
      new CreateReceiptRuleSetCommand({
        RuleSetName: ruleSetName,
      }),
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AlreadyExistsException") {
      throw error;
    }
  }

  await getSesClient().send(
    new SetActiveReceiptRuleSetCommand({
      RuleSetName: ruleSetName,
    }),
  );

  return ruleSetName;
};

const ensureReceiptRule = async (input: { domain: string; s3Bucket: string }) => {
  const ruleName = toReceiptRuleName(input.domain);
  const ruleSetName = await ensureReceiptRuleSet();
  const snsTopicArn = await getReceiptTopicArn();
  const iamRoleArn = await getReceiptRoleArn();

  const receiptRule = {
    Actions: [
      {
        S3Action: {
          BucketName: input.s3Bucket,
          IamRoleArn: iamRoleArn,
          TopicArn: snsTopicArn,
        },
      },
    ],
    Enabled: true,
    Name: ruleName,
    Recipients: [input.domain],
    ScanEnabled: true,
    TlsPolicy: "Optional" as const,
  };

  try {
    await getSesClient().send(
      new DescribeReceiptRuleCommand({
        RuleName: ruleName,
        RuleSetName: ruleSetName,
      }),
    );

    await getSesClient().send(
      new UpdateReceiptRuleCommand({
        Rule: receiptRule,
        RuleSetName: ruleSetName,
      }),
    );
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    await getSesClient().send(
      new CreateReceiptRuleCommand({
        Rule: receiptRule,
        RuleSetName: ruleSetName,
      }),
    );
  }

  return {
    ruleName,
    ruleSetName,
  };
};

const toDnsRecords = (
  domain: string,
  identity: GetEmailIdentityCommandOutput,
  region: string,
): MailDnsRecord[] => {
  const records: MailDnsRecord[] = [];

  for (const token of identity.DkimAttributes?.Tokens ?? []) {
    records.push({
      name: `${token}._domainkey`,
      purpose: "SES DKIM verification",
      type: "CNAME",
      value: `${token}.dkim.amazonses.com`,
    });
  }

  records.push({
    name: domain,
    priority: 10,
    purpose: "SES inbound MX",
    type: "MX",
    value: toInboundMxValue(region),
  });

  const mailFromDomain = identity.MailFromAttributes?.MailFromDomain || toMailFromDomain(domain);

  records.push({
    name: mailFromDomain,
    priority: 10,
    purpose: "SES custom MAIL FROM MX",
    type: "MX",
    value: toMailFromMxValue(region),
  });
  records.push({
    name: mailFromDomain,
    purpose: "SES custom MAIL FROM SPF",
    type: "TXT",
    value: toMailFromTxtValue(),
  });

  return records;
};

const toMailDomainSetup = async (input: {
  domain: {
    createdAt: Date;
    domain: string;
    id: string;
    inboundKeyPrefix: string;
    isActive: boolean;
    organizationId: string;
    s3Bucket: string;
    updatedAt: Date;
  };
  identity: GetEmailIdentityCommandOutput | null;
}) => {
  const region = getMailAwsRegion();
  const receiptRuleSetName = await getReceiptRuleSetName();
  const receiptRuleName = toReceiptRuleName(input.domain.domain);
  const mailFromDomain =
    input.identity?.MailFromAttributes?.MailFromDomain || toMailFromDomain(input.domain.domain);
  const dnsRecords = input.identity
    ? toDnsRecords(input.domain.domain, input.identity, region)
    : [
        {
          name: input.domain.domain,
          priority: 10,
          purpose: "SES inbound MX",
          type: "MX" as const,
          value: toInboundMxValue(region),
        },
        {
          name: mailFromDomain,
          priority: 10,
          purpose: "SES custom MAIL FROM MX",
          type: "MX" as const,
          value: toMailFromMxValue(region),
        },
        {
          name: mailFromDomain,
          purpose: "SES custom MAIL FROM SPF",
          type: "TXT" as const,
          value: toMailFromTxtValue(),
        },
      ];

  return {
    awsRegion: region,
    dkimStatus: input.identity?.DkimAttributes?.Status ?? null,
    dnsRecords,
    domain: input.domain.domain,
    domainId: input.domain.id,
    inboundReady:
      (input.identity?.VerificationStatus ?? null) === "SUCCESS" && input.domain.isActive,
    inboundS3Bucket: input.domain.s3Bucket,
    ingressUrl: await getMailIngressUrl(),
    isActive: input.domain.isActive,
    mailFromDomain,
    mailFromStatus: input.identity?.MailFromAttributes?.MailFromDomainStatus ?? null,
    outboundReady:
      Boolean(input.identity?.VerifiedForSendingStatus) &&
      (input.identity?.VerificationStatus ?? null) === "SUCCESS" &&
      input.domain.isActive,
    outboundUrl: await getMailOutboundUrl(),
    receiptRuleName,
    receiptRuleSetName,
    s3Bucket: input.domain.s3Bucket,
    verificationStatus: input.identity?.VerificationStatus ?? null,
    verifiedForSendingStatus: Boolean(input.identity?.VerifiedForSendingStatus),
  } satisfies MailDomainSetup;
};

const getIdentityOrNull = async (domain: string) => {
  try {
    return await getSesv2Client().send(
      new GetEmailIdentityCommand({
        EmailIdentity: domain,
      }),
    );
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
};

export const registerMailDomain = async (input: {
  domain: string;
  inboundKeyPrefix?: string;
  isActive?: boolean;
  organizationId: string;
  s3Bucket?: string;
}) => {
  const record = await upsertMailDomain(input);

  const identity = await ensureIdentity(record.domain);
  await ensureMailFromAttributes(record.domain);
  await ensureReceiptRule({
    domain: record.domain,
    s3Bucket: record.s3Bucket,
  });

  const refreshedIdentity = await getIdentityOrNull(record.domain);

  return await toMailDomainSetup({
    domain: record,
    identity: refreshedIdentity ?? identity,
  });
};

export const getMailDomainSetup = async (domainId: string, organizationId: string) => {
  const domain = (await listMailDomainsForOrganization(organizationId)).find(
    (record) => record.id === domainId,
  );

  if (!domain) {
    return null;
  }

  return await toMailDomainSetup({
    domain,
    identity: await getIdentityOrNull(domain.domain),
  });
};

export const listMailDomainSetupsForOrganization = async (organizationId: string) => {
  const domains = await listMailDomainsForOrganization(organizationId);

  return await Promise.all(
    domains.map(
      async (domain) =>
        await toMailDomainSetup({
          domain,
          identity: await getIdentityOrNull(domain.domain),
        }),
    ),
  );
};

export const sendManagedMail = async (input: {
  bcc?: string[];
  cc?: string[];
  from: string;
  html?: string;
  replyTo?: string[];
  subject: string;
  text?: string;
  to: string[];
}) => {
  const fromDomain = input.from.trim().toLowerCase().split("@").at(-1) ?? "";
  const mailDomain = await findMailDomainByDomain(fromDomain);

  if (!mailDomain) {
    throw new Error("No active mail domain matched the sender domain.");
  }

  const response = await getSesv2Client().send(
    new SendEmailCommand({
      Content: {
        Simple: {
          Body: {
            ...(input.html
              ? {
                  Html: {
                    Charset: "UTF-8",
                    Data: input.html,
                  },
                }
              : {}),
            ...(input.text
              ? {
                  Text: {
                    Charset: "UTF-8",
                    Data: input.text,
                  },
                }
              : {}),
          },
          Subject: {
            Charset: "UTF-8",
            Data: input.subject,
          },
        },
      },
      Destination: {
        BccAddresses: input.bcc,
        CcAddresses: input.cc,
        ToAddresses: input.to,
      },
      FromEmailAddress: input.from.trim().toLowerCase(),
      ReplyToAddresses: input.replyTo,
    }),
  );

  return {
    domain: mailDomain.domain,
    messageId: response.MessageId ?? null,
    sent: true,
  };
};
