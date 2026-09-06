import { ORPCError } from "@orpc/server";
import { assertOrganizationApiKeyAuthorization } from "@quieter/auth/api-key-verification";
import type { OrganizationApiKeyIdentity } from "@quieter/auth/api-key-verification";
import {
  getOrganizationBillingEntitlement,
  getOrganizationSubscriptionRecord,
} from "@quieter/billing/entitlements";
import { reserveMailSubmissionUsage } from "@quieter/billing/mail-submission-usage";
import { estimateOutboundOrganizationMailUsage } from "@quieter/billing/organization-mail-usage";
import type { DatabaseClient } from "@quieter/database/client";
import { acceptMailSubmission } from "@quieter/database/mail-acceptance";
import type { MailAdmissionLimits } from "@quieter/database/mail-admission";
import type { MailStorageLimits } from "@quieter/database/mail-storage-capacity";
import {
  findMailSubmissionReplay,
  readMailSubmissionStatus,
} from "@quieter/database/mail-submission-read";

import { prepareMailSubmissionPayload } from "./mail-submission-payload.ts";
import type { SubmissionPayloadStorage } from "./mail-submission-payload.ts";
import { normalizeMailSubmissionRequest } from "./mail-submission-request.ts";
import {
  assertOrganizationMailRecipientsNotSuppressed,
  buildOpenTrackingHtmlTransform,
  resolveOrganizationMailOpenTracking,
} from "./organization-mail-delivery.ts";
import {
  assertOrganizationOwnsVerifiedSenderDomain,
  OrganizationMailSendError,
} from "./organization-mail-policy.ts";

export const acceptOrganizationMailSubmission = async (
  database: DatabaseClient,
  input: {
    identity: OrganizationApiKeyIdentity;
    message: unknown;
    idempotencyKey: string;
    storage: SubmissionPayloadStorage;
    limits: MailAdmissionLimits;
    storageLimits: MailStorageLimits;
  }
) => {
  if (!/^[\u0021-\u007E]{1,128}$/u.test(input.idempotencyKey)) {
    throw new OrganizationMailSendError(
      "A valid Idempotency-Key header is required.",
      400
    );
  }
  const { message, requestHash } = normalizeMailSubmissionRequest(
    input.message
  );
  if (
    message.idempotencyKey !== undefined &&
    message.idempotencyKey !== input.idempotencyKey
  ) {
    throw new OrganizationMailSendError(
      "The message and header idempotency keys must match.",
      400
    );
  }
  const { organizationId } = input.identity;
  await getOrganizationSubscriptionRecord(organizationId);
  const assertAuthorization = async (
    transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]
  ) => {
    await assertOrganizationApiKeyAuthorization(transaction, input.identity);
    const entitlement = await getOrganizationBillingEntitlement({
      database: transaction,
      feature: "organizationApiKeys",
      organizationId,
    });
    if (!entitlement.hasAccess) {
      throw new ORPCError("FORBIDDEN", {
        message: "API access requires an active eligible plan.",
      });
    }
  };
  const replay = await findMailSubmissionReplay(database, {
    assertAuthorization,
    idempotencyKey: input.idempotencyKey,
    mailboxId: null,
    organizationId,
    requestHash,
  });
  if (replay !== null) {
    return { replayed: true, result: replay };
  }
  await assertOrganizationOwnsVerifiedSenderDomain({
    database,
    organizationId,
    sender: message.from,
  });
  const recipients = [
    ...message.to,
    ...(message.cc ?? []),
    ...(message.bcc ?? []),
  ];
  await assertOrganizationMailRecipientsNotSuppressed({
    database,
    organizationId,
    recipients,
  });
  const openTracking = await resolveOrganizationMailOpenTracking({
    database,
    openTracking: message.openTracking,
    organizationId,
  });
  const prepared = await prepareMailSubmissionPayload(database, {
    message,
    openTracking,
    organizationId,
    storage: input.storage,
    storageLimits: input.storageLimits,
    transformHtml(html, messageHeaderId) {
      const transform = buildOpenTrackingHtmlTransform({
        messageHeaderId,
        openTrackingEnabled: openTracking,
      });
      return transform.htmlTransform?.(html) ?? html;
    },
  });
  const estimate = estimateOutboundOrganizationMailUsage({
    attachmentSizeBytes: prepared.attachmentBytes,
    bcc: message.bcc,
    cc: message.cc,
    html: message.html,
    subject: message.subject,
    text: message.text,
    to: message.to,
  });
  return await acceptMailSubmission(database, {
    ...prepared,
    assertAuthorization,
    idempotencyKey: input.idempotencyKey,
    limits: input.limits,
    mailboxId: null,
    organizationId,
    requestHash,
    async reserveBudget(transaction) {
      await assertOrganizationOwnsVerifiedSenderDomain({
        database: transaction,
        organizationId,
        sender: message.from,
      });
      await assertOrganizationMailRecipientsNotSuppressed({
        database: transaction,
        organizationId,
        recipients,
      });
      return await reserveMailSubmissionUsage(transaction, {
        organizationId,
        sesCostMicroCents: estimate.sesCostMicroCents,
      });
    },
    storageLimits: input.storageLimits,
  });
};

export const getOrganizationMailSubmission = async (
  database: DatabaseClient,
  input: {
    identity: OrganizationApiKeyIdentity;
    messageId: string;
  }
) =>
  await readMailSubmissionStatus(database, {
    async assertAuthorization(transaction) {
      await assertOrganizationApiKeyAuthorization(transaction, input.identity);
    },
    mailboxId: null,
    messageId: input.messageId,
    organizationId: input.identity.organizationId,
  });
