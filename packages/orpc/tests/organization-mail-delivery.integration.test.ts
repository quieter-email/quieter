/// <reference types="node" />

import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailMessage,
  organization,
  organizationApiMailMessage,
  organizationMailDeliveryRecipient,
  organizationMailOpenEvent,
} from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  getOrganizationMailDelivery,
  getOrganizationMailDeliveryMetrics,
  getOrganizationMailTrackingSettings,
  setOrganizationMailTrackingSettings,
  listOrganizationMailRecipientSuppressions,
  listOrganizationMailSuppressionAudit,
  recordOrganizationMailFeedback,
  recordOrganizationMailMarkerLoad,
  reconcileOrganizationMailDeliveryRecipients,
  suppressOrganizationMailRecipient,
  unsuppressOrganizationMailRecipient,
} from "../src/organization-mail-delivery";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: { ...original.serverEnv, DATABASE_URL: databaseUrl },
  };
});

describe.skipIf(databaseUrl === undefined)(
  "delivery persistence on migrated PostgreSQL",
  () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const mailboxId = randomUUID();
    const providerMessageId = randomUUID();
    const multiMessageId = randomUUID();
    const messageHeaderId = `<${randomUUID()}@example.com>`;
    const recipient = "delivery-test@example.com";
    const now = new Date();

    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Delivery integration tests require loopback quieter_migration_test."
        );
      }
      await db.insert(organization).values(
        [organizationId, otherOrganizationId].map((id) => ({
          createdAt: now,
          id,
          name: "Delivery fixture",
          slug: id,
        }))
      );
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress: `${mailboxId}@example.com`,
        id: mailboxId,
        organizationId,
        provider: "managed",
        updatedAt: now,
      });
      await db.insert(organizationApiMailMessage).values([
        {
          createdAt: now,
          from: "sender@example.com",
          id: randomUUID(),
          messageHeaderId,
          organizationId,
          providerMessageId,
          senderAddress: "sender@example.com",
          sentAt: now,
          to: recipient,
          updatedAt: now,
        },
        {
          bcc: "hidden@example.com",
          createdAt: now,
          from: "sender@example.com",
          id: randomUUID(),
          messageHeaderId: `<${multiMessageId}@example.com>`,
          organizationId,
          providerMessageId: multiMessageId,
          senderAddress: "sender@example.com",
          sentAt: now,
          to: recipient,
          updatedAt: now,
        },
      ]);
      await db.insert(managedMailMessage).values({
        createdAt: now,
        direction: "outbound",
        from: "sender@example.com",
        id: randomUUID(),
        mailboxId,
        messageHeaderId,
        providerMessageId,
        sentAt: now,
        threadId: randomUUID(),
        to: recipient,
        updatedAt: now,
      });
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, [organizationId, otherOrganizationId]));
    });

    test("concurrent partial tracking updates preserve both settings", async () => {
      await Promise.all([
        setOrganizationMailTrackingSettings({
          actorUserId: "fixture-admin",
          openTrackingEnabled: true,
          organizationId,
        }),
        setOrganizationMailTrackingSettings({
          actorUserId: "fixture-admin",
          allowPerSendOverride: true,
          organizationId,
        }),
      ]);
      await expect(
        getOrganizationMailTrackingSettings({ organizationId })
      ).resolves.toStrictEqual({
        allowPerSendOverride: true,
        openTrackingEnabled: true,
      });
    });

    test("concurrent delivery, duplicate feedback and reconciliation converge", async () => {
      const feedback = {
        eventType: "delivered" as const,
        occurredAt: now,
        organizationId,
        provider: "ses",
        providerMessageId,
        recipients: [{ emailAddress: recipient }],
        sourceEventId: randomUUID(),
      };
      await Promise.all([
        recordOrganizationMailFeedback(feedback),
        recordOrganizationMailFeedback(feedback),
        recordOrganizationMailFeedback({
          ...feedback,
          eventType: "sent",
          occurredAt: new Date(now.getTime() + 1000),
          sourceEventId: randomUUID(),
        }),
        reconcileOrganizationMailDeliveryRecipients({
          organizationId,
          providerMessageId,
        }),
      ]);
      const delivery = await getOrganizationMailDelivery({
        organizationId,
        providerMessageId,
      });
      expect(delivery?.events).toHaveLength(2);
      expect(delivery?.recipients[0]?.status).toBe("delivered");
      expect(delivery?.recipients[0]?.lastEventAt).toStrictEqual(
        new Date(now.getTime() + 1000)
      );
      await reconcileOrganizationMailDeliveryRecipients({
        organizationId,
        providerMessageId,
      });
      const reconciled = await getOrganizationMailDelivery({
        organizationId,
        providerMessageId,
      });
      expect(reconciled?.recipients).toStrictEqual(delivery?.recipients);
      await expect(
        getOrganizationMailDelivery({
          organizationId: otherOrganizationId,
          providerMessageId,
        })
      ).resolves.toBeNull();
    });

    test("single and multi-recipient opens never replace delivery and obey mailbox scope", async () => {
      await recordOrganizationMailMarkerLoad({
        messageHeaderId,
        occurredAt: now,
      });
      await recordOrganizationMailMarkerLoad({
        messageHeaderId,
        occurredAt: new Date(now.getTime() - 1000),
      });
      await recordOrganizationMailMarkerLoad({
        messageHeaderId: `<${multiMessageId}@example.com>`,
        occurredAt: now,
      });
      const delivery = await getOrganizationMailDelivery({
        organizationId,
        providerMessageId,
      });
      expect(delivery?.recipients[0]?.status).toBe("delivered");
      const [scoped, all, missing] = await Promise.all([
        getOrganizationMailDeliveryMetrics({ mailboxId, organizationId }),
        getOrganizationMailDeliveryMetrics({ organizationId }),
        getOrganizationMailDeliveryMetrics({
          mailboxId: "missing",
          organizationId,
        }),
      ]);
      expect([
        scoped.openedMessages,
        all.openedMessages,
        missing.openedMessages,
      ]).toStrictEqual([1, 2, 0]);
      const [open] = await db
        .select()
        .from(organizationMailOpenEvent)
        .where(eq(organizationMailOpenEvent.providerMessageId, multiMessageId));
      expect(open?.recipient).toBeNull();
      const [single] = await db
        .select()
        .from(organizationMailOpenEvent)
        .where(
          eq(organizationMailOpenEvent.providerMessageId, providerMessageId)
        );
      expect(single?.lastOpenedAt).toStrictEqual(now);
      expect(single?.reportedOpenCount).toBe(2);
    });

    test("unblocking defeats old feedback and a later manual block has its own reason", async () => {
      await recordOrganizationMailFeedback({
        eventType: "complained",
        occurredAt: now,
        provider: "ses",
        providerMessageId,
        recipients: [{ emailAddress: recipient }],
        sourceEventId: randomUUID(),
      });
      await unsuppressOrganizationMailRecipient({
        actorUserId: "fixture-admin",
        organizationId,
        recipient,
      });
      await recordOrganizationMailFeedback({
        eventType: "bounced",
        occurredAt: now,
        permanentFailure: true,
        provider: "ses",
        providerMessageId,
        recipients: [{ emailAddress: recipient }],
        sourceEventId: randomUUID(),
      });
      await expect(
        listOrganizationMailRecipientSuppressions({ organizationId })
      ).resolves.toHaveLength(0);
      await suppressOrganizationMailRecipient({
        actorUserId: "fixture-admin",
        organizationId,
        recipient,
      });
      await expect(
        listOrganizationMailRecipientSuppressions({ organizationId })
      ).resolves.toStrictEqual([
        expect.objectContaining({
          reason: "manual",
          sourceProviderMessageId: null,
        }),
      ]);
      await expect(
        listOrganizationMailSuppressionAudit({ organizationId })
      ).resolves.toHaveLength(3);
      const [projection] = await db
        .select()
        .from(organizationMailDeliveryRecipient)
        .where(
          eq(
            organizationMailDeliveryRecipient.providerMessageId,
            providerMessageId
          )
        );
      expect(projection?.status).toBe("complained");
    });
  }
);
