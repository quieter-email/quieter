import { db, mailDomain, mailMessage } from "@quietr/database";
import { and, desc, eq, inArray } from "drizzle-orm";

const DEFAULT_INBOUND_KEY_PREFIX = "mail/inbound";

type MailDomainRecord = {
  createdAt: Date;
  domain: string;
  id: string;
  inboundKeyPrefix: string;
  isActive: boolean;
  organizationId: string;
  s3Bucket: string;
  updatedAt: Date;
};

const mailDomainSelect = {
  createdAt: mailDomain.createdAt,
  domain: mailDomain.domain,
  id: mailDomain.id,
  inboundKeyPrefix: mailDomain.inboundKeyPrefix,
  isActive: mailDomain.isActive,
  organizationId: mailDomain.organizationId,
  s3Bucket: mailDomain.s3Bucket,
  updatedAt: mailDomain.updatedAt,
};

const mailMessageSelect = {
  createdAt: mailMessage.createdAt,
  id: mailMessage.id,
  mailDomainId: mailMessage.mailDomainId,
  mailFrom: mailMessage.mailFrom,
  messageIdHeader: mailMessage.messageIdHeader,
  organizationId: mailMessage.organizationId,
  providerMessageId: mailMessage.providerMessageId,
  rawSizeBytes: mailMessage.rawSizeBytes,
  receivedAt: mailMessage.receivedAt,
  recipientsJson: mailMessage.recipientsJson,
  s3Bucket: mailMessage.s3Bucket,
  s3Key: mailMessage.s3Key,
  subject: mailMessage.subject,
};

const normalizeDotlessLowerCase = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");

const readConfiguredEnv = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
};

export const normalizeMailDomain = (domain: string) => normalizeDotlessLowerCase(domain);

export const getConfiguredMailBucket = () => {
  const bucket = readConfiguredEnv("MAIL_S3_BUCKET", "EMAIL_S3_BUCKET", "MANAGED_MAIL_S3_BUCKET");

  if (!bucket) {
    throw new Error("MAIL_S3_BUCKET environment variable is missing.");
  }

  return bucket;
};

const getConfiguredInboundKeyPrefix = () =>
  readConfiguredEnv("MAIL_S3_PREFIX", "EMAIL_S3_PREFIX", "MANAGED_MAIL_S3_PREFIX") ||
  DEFAULT_INBOUND_KEY_PREFIX;

export const listMailDomainsForOrganization = async (organizationId: string) => {
  return await db
    .select(mailDomainSelect)
    .from(mailDomain)
    .where(eq(mailDomain.organizationId, organizationId))
    .orderBy(mailDomain.domain);
};

export const upsertMailDomain = async (input: {
  domain: string;
  inboundKeyPrefix?: string;
  isActive?: boolean;
  organizationId: string;
  s3Bucket?: string;
}) => {
  const now = new Date();
  const domain = normalizeMailDomain(input.domain);
  const [existingRecord] = await db
    .select(mailDomainSelect)
    .from(mailDomain)
    .where(eq(mailDomain.domain, domain))
    .limit(1);
  const inboundKeyPrefix =
    input.inboundKeyPrefix?.trim() ||
    existingRecord?.inboundKeyPrefix ||
    getConfiguredInboundKeyPrefix();
  const s3Bucket = input.s3Bucket?.trim() || existingRecord?.s3Bucket || getConfiguredMailBucket();

  await db
    .insert(mailDomain)
    .values({
      createdAt: now,
      domain,
      id: crypto.randomUUID(),
      inboundKeyPrefix,
      isActive: input.isActive ?? true,
      organizationId: input.organizationId,
      s3Bucket,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: mailDomain.domain,
      set: {
        inboundKeyPrefix,
        isActive: input.isActive ?? true,
        organizationId: input.organizationId,
        s3Bucket,
        updatedAt: now,
      },
    });

  const [record] = await db
    .select(mailDomainSelect)
    .from(mailDomain)
    .where(eq(mailDomain.domain, domain))
    .limit(1);

  if (!record) {
    throw new Error("Mail domain could not be created.");
  }

  return record;
};

const getRecipientDomain = (recipient: string) => {
  const normalizedRecipient = normalizeDotlessLowerCase(recipient);
  const atIndex = normalizedRecipient.lastIndexOf("@");

  return atIndex >= 0 ? normalizedRecipient.slice(atIndex + 1) : "";
};

export const findMailDomainByDomain = async (domain: string) => {
  const normalizedDomain = normalizeMailDomain(domain);

  if (!normalizedDomain) {
    return null;
  }

  const [record] = await db
    .select(mailDomainSelect)
    .from(mailDomain)
    .where(and(eq(mailDomain.domain, normalizedDomain), eq(mailDomain.isActive, true)))
    .limit(1);

  return record ?? null;
};

export const findMailDomainByRecipients = async (recipients: string[]) => {
  const recipientDomains = Array.from(
    new Set(
      recipients.map(getRecipientDomain).filter((domain): domain is string => Boolean(domain)),
    ),
  );

  if (recipientDomains.length === 0) {
    return null;
  }

  const domains = await db
    .select(mailDomainSelect)
    .from(mailDomain)
    .where(and(eq(mailDomain.isActive, true), inArray(mailDomain.domain, recipientDomains)));

  const domainMap = new Map(domains.map((domain) => [domain.domain, domain]));

  for (const recipient of recipients) {
    const match = domainMap.get(getRecipientDomain(recipient));

    if (match) {
      return match;
    }
  }

  return null;
};

export const findMailMessageByProviderMessageId = async (input: {
  mailDomainId: string;
  providerMessageId: string;
}) => {
  const normalizedProviderMessageId = input.providerMessageId.trim();

  if (!normalizedProviderMessageId) {
    return null;
  }

  const [message] = await db
    .select(mailMessageSelect)
    .from(mailMessage)
    .where(
      and(
        eq(mailMessage.mailDomainId, input.mailDomainId),
        eq(mailMessage.providerMessageId, normalizedProviderMessageId),
      ),
    )
    .limit(1);

  return message ?? null;
};

export const createMailMessage = async (input: {
  mailFrom?: string | null;
  mailDomainId: string;
  messageIdHeader?: string | null;
  organizationId: string;
  providerMessageId?: string | null;
  rawSizeBytes: number;
  receivedAt: Date;
  recipients: string[];
  s3Bucket: string;
  s3Key: string;
  subject?: string | null;
}) => {
  const now = new Date();
  const [record] = await db
    .insert(mailMessage)
    .values({
      createdAt: now,
      id: crypto.randomUUID(),
      mailDomainId: input.mailDomainId,
      mailFrom: input.mailFrom?.trim() || null,
      messageIdHeader: input.messageIdHeader?.trim() || null,
      organizationId: input.organizationId,
      providerMessageId: input.providerMessageId?.trim() || null,
      rawSizeBytes: input.rawSizeBytes,
      receivedAt: input.receivedAt,
      recipientsJson: JSON.stringify(input.recipients),
      s3Bucket: input.s3Bucket,
      s3Key: input.s3Key,
      subject: input.subject?.trim() || null,
    })
    .returning(mailMessageSelect);

  if (!record) {
    throw new Error("Mail message could not be stored.");
  }

  return record;
};

export const listMailMessagesForOrganization = async (input: {
  limit?: number;
  organizationId: string;
}) => {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);

  const rows = await db
    .select({
      ...mailMessageSelect,
      domain: mailDomain.domain,
    })
    .from(mailMessage)
    .innerJoin(mailDomain, eq(mailMessage.mailDomainId, mailDomain.id))
    .where(eq(mailMessage.organizationId, input.organizationId))
    .orderBy(desc(mailMessage.receivedAt))
    .limit(limit);

  return rows.map((row) => {
    const parsedRecipients = JSON.parse(row.recipientsJson);

    return {
      createdAt: row.createdAt,
      domain: row.domain,
      id: row.id,
      mailDomainId: row.mailDomainId,
      mailFrom: row.mailFrom,
      messageIdHeader: row.messageIdHeader,
      organizationId: row.organizationId,
      providerMessageId: row.providerMessageId,
      rawSizeBytes: row.rawSizeBytes,
      receivedAt: row.receivedAt,
      recipients: Array.isArray(parsedRecipients)
        ? parsedRecipients.filter((recipient) => typeof recipient === "string")
        : [],
      s3Bucket: row.s3Bucket,
      s3Key: row.s3Key,
      subject: row.subject,
    };
  });
};

export const buildMailObjectKey = (
  domain: Pick<MailDomainRecord, "domain" | "id" | "inboundKeyPrefix">,
  receivedAt: Date,
) => {
  const year = String(receivedAt.getUTCFullYear());
  const month = String(receivedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(receivedAt.getUTCDate()).padStart(2, "0");

  return `${domain.inboundKeyPrefix}/${domain.id}/${year}/${month}/${day}/${crypto.randomUUID()}.eml`;
};
