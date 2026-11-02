import { randomUUID } from "node:crypto";

import type { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";
import type { DatabaseTransaction } from "@quieter/database/client";
import { assertLocalDevelopmentDatabaseUrl } from "@quieter/database/local-development";
import {
  organization,
  organizationAudience,
  organizationAudienceLifecycleEvent,
  organizationAudienceMembership,
  organizationCampaign,
  organizationCampaignRecipient,
  organizationContact,
  organizationMailRecipientSuppression,
} from "@quieter/database/schema";
import { renderCampaignEmail } from "@quieter/mail/campaign-unsubscribe";
import {
  campaignCreateInputSchema,
  campaignSendInputSchema,
  campaignUpdateInputSchema,
} from "@quieter/mail/campaigns";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { update as updateAudience } from "../../src/audiences/queries";
import {
  createCampaign,
  loadCampaign,
  previewCampaign,
  sendCampaign,
  unsubscribeCampaignRecipient,
  updateCampaign,
} from "../../src/campaigns/service";
import type { GrowthActor } from "../../src/growth-access";
import type { assertOrganizationOwnsVerifiedSenderDomain } from "../../src/organization-mail-policy";

const state = vi.hoisted(
  (): {
    databaseUrl: string | undefined;
    deploymentEnvironment: string | undefined;
    planetScaleHost: string | undefined;
    managedOrigin: string;
    transaction: DatabaseTransaction | undefined;
  } => ({
    databaseUrl: process.env.CAMPAIGN_POLICY_TEST_DATABASE_URL,
    deploymentEnvironment: process.env.CAMPAIGN_POLICY_TEST_DEPLOYMENT_ENV,
    managedOrigin: "https://mail.example.com",
    planetScaleHost: process.env.CAMPAIGN_POLICY_TEST_PLANETSCALE_HOST,
    transaction: undefined,
  })
);

// Services can only obtain the active rollback transaction. Their transactions become savepoints.
vi.mock(import("@quieter/database/client"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(_target, property): unknown {
        const { transaction } = state;
        if (transaction === undefined || property === "$client") {
          throw new Error(
            "Campaign policy tests require an active rollback transaction."
          );
        }
        const value: unknown = Reflect.get(transaction, property);
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            const result: unknown = Reflect.apply(value, transaction, args);
            return result;
          };
        }
        return value;
      },
    }),
    withRequestDatabaseClient: async () =>
      await Promise.reject(
        new Error("Campaign policy tests must use the rollback transaction.")
      ),
  };
});
vi.mock(import("@quieter/billing/entitlements"), () => ({
  getOrganizationBillingEntitlement: vi
    .fn<typeof getOrganizationBillingEntitlement>()
    .mockResolvedValue({
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: null,
    }),
}));
vi.mock(import("../../src/organization-mail-policy"), () => ({
  assertOrganizationOwnsVerifiedSenderDomain: vi
    .fn<typeof assertOrganizationOwnsVerifiedSenderDomain>()
    .mockResolvedValue("example.com"),
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      get BETTER_AUTH_URL() {
        return state.managedOrigin;
      },
      QUIETER_DEPLOYMENT_ENV: "local",
    } satisfies typeof actual.serverEnv,
  };
});

type Fixture = {
  actor: GrowthActor;
  draftInput: Parameters<typeof createCampaign>[1];
  transaction: DatabaseTransaction;
};

describe.skipIf(state.databaseUrl === undefined)(
  "campaign unsubscribe policy on PostgreSQL",
  () => {
    let connection: ReturnType<typeof postgres> | undefined;

    beforeAll(() => {
      const { databaseUrl } = state;
      if (databaseUrl === undefined) {
        throw new Error("No campaign policy test database was configured.");
      }
      assertLocalDevelopmentDatabaseUrl("DATABASE_URL", databaseUrl, {
        QUIETER_DEPLOYMENT_ENV: state.deploymentEnvironment,
        QUIETER_LOCAL_PLANETSCALE_HOST: state.planetScaleHost,
      });
      const url = new URL(databaseUrl);
      if (
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        !["/quieter_migration_test", "/quieter_campaign_test"].includes(
          url.pathname
        )
      ) {
        throw new Error(
          "Loopback campaign policy tests require a disposable test database."
        );
      }
      connection = postgres(databaseUrl, {
        connect_timeout: 10,
        idle_timeout: 5,
        max: 1,
        prepare: false,
      });
    });

    afterAll(async () => {
      await connection?.end();
    });

    const withRollbackFixture = async (
      run: (fixture: Fixture) => Promise<void>
    ) => {
      if (connection === undefined) {
        throw new Error("The guarded database connection is unavailable.");
      }
      const database = drizzle({ client: connection });
      const organizationId = randomUUID();
      const audienceId = randomUUID();
      const contactId = randomUUID();
      const rollback = new Error("Rollback synthetic campaign fixtures.");
      try {
        await database.transaction(async (transaction) => {
          state.transaction = transaction;
          try {
            await transaction.execute(sql`set local statement_timeout = '10s'`);
            await transaction.execute(sql`set local lock_timeout = '3s'`);
            const now = new Date();
            await transaction.insert(organization).values({
              createdAt: now,
              id: organizationId,
              name: "Synthetic campaign policy verification",
              slug: organizationId,
            });
            await transaction.insert(organizationAudience).values({
              createdAt: now,
              id: audienceId,
              name: "Synthetic subscribers",
              organizationId,
              unsubscribePolicy: {
                kind: "custom",
                urlTemplate:
                  "https://audience.example.com/leave/{{unsubscribe_token}}",
              },
              updatedAt: now,
            });
            await transaction.insert(organizationContact).values({
              createdAt: now,
              email: `${contactId}@example.com`,
              id: contactId,
              name: "Synthetic subscriber",
              organizationId,
              updatedAt: now,
            });
            await transaction.insert(organizationAudienceMembership).values({
              audienceId,
              consentOccurredAt: now,
              consentSource: "Synthetic rollback verification",
              contactId,
              createdAt: now,
              id: randomUUID(),
              lastLifecycleOccurredAt: now,
              organizationId,
              status: "subscribed",
              tags: ["synthetic"],
              updatedAt: now,
            });
            await run({
              actor: {
                apiKeyId: randomUUID(),
                organizationId,
                scopes: [
                  "audiences:read",
                  "audiences:write",
                  "campaigns:read",
                  "campaigns:write",
                  "campaigns:send",
                ],
              },
              draftInput: campaignCreateInputSchema.parse({
                audienceId,
                from: "sender@example.com",
                name: "Synthetic policy campaign",
                organizationId,
                subject: "Synthetic policy verification",
                text: "Synthetic message body.",
              }),
              transaction,
            });
          } finally {
            state.transaction = undefined;
          }
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) {
          throw error;
        }
      }
      const persisted = await database
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId));
      expect(persisted).toHaveLength(0);
    };

    test("an omitted draft update preserves the override and explicit null restores inheritance", async () => {
      await withRollbackFixture(async ({ actor, draftInput }) => {
        const campaign = await createCampaign(actor, {
          ...draftInput,
          unsubscribeOverride: { kind: "managed" },
        });
        const updated = await updateCampaign(
          actor,
          campaignUpdateInputSchema.parse({
            ...draftInput,
            campaignId: campaign.id,
            expectedUpdatedAt: campaign.updatedAt,
            subject: "Updated synthetic subject",
          })
        );
        expect(updated.unsubscribeOverride).toMatchObject({ kind: "managed" });
        const overridden = await previewCampaign(actor, {
          campaignId: campaign.id,
          organizationId: actor.organizationId,
        });
        expect(overridden.message.text).toContain(
          "https://mail.example.com/unsubscribe/"
        );

        const inherited = await updateCampaign(
          actor,
          campaignUpdateInputSchema.parse({
            ...draftInput,
            campaignId: campaign.id,
            expectedUpdatedAt: updated.updatedAt,
            unsubscribeOverride: null,
          })
        );
        expect(inherited.unsubscribeOverride).toBeNull();
        const preview = await previewCampaign(actor, {
          campaignId: campaign.id,
          organizationId: actor.organizationId,
        });
        expect(preview.message.text).toContain(
          "https://audience.example.com/leave/"
        );
      });
    });

    test("changing the audience default after review rejects confirmation without inserting recipients", async () => {
      await withRollbackFixture(async ({ actor, draftInput, transaction }) => {
        const campaign = await createCampaign(actor, draftInput);
        const review = await previewCampaign(actor, {
          campaignId: campaign.id,
          organizationId: actor.organizationId,
        });
        expect(review.eligibleCount).toBeGreaterThan(0);
        await updateAudience(actor, {
          audienceId: campaign.audienceId,
          organizationId: actor.organizationId,
          unsubscribePolicy: { kind: "managed" },
        });
        await expect(
          sendCampaign(
            actor,
            campaignSendInputSchema.parse({
              campaignId: campaign.id,
              confirmed: true,
              expectedUpdatedAt: campaign.updatedAt,
              idempotencyKey: randomUUID(),
              organizationId: actor.organizationId,
              previewToken: review.previewToken,
            })
          )
        ).rejects.toMatchObject({ code: "CONFLICT" });
        const recipients = await transaction
          .select({ id: organizationCampaignRecipient.id })
          .from(organizationCampaignRecipient)
          .where(eq(organizationCampaignRecipient.campaignId, campaign.id));
        expect(recipients).toHaveLength(0);
        const stored = await loadCampaign(actor.organizationId, campaign.id);
        expect(stored.status).toBe("draft");
        expect(stored.unsubscribeSnapshot).toBeNull();
      });
    });

    test("queued links stay frozen after audience edits and repeated confirmation creates no new recipients", async () => {
      await withRollbackFixture(async ({ actor, draftInput, transaction }) => {
        const campaign = await createCampaign(actor, draftInput);
        const review = await previewCampaign(actor, {
          campaignId: campaign.id,
          organizationId: actor.organizationId,
        });
        const confirmation = campaignSendInputSchema.parse({
          campaignId: campaign.id,
          confirmed: true,
          expectedUpdatedAt: campaign.updatedAt,
          idempotencyKey: randomUUID(),
          organizationId: actor.organizationId,
          previewToken: review.previewToken,
        });
        await sendCampaign(actor, confirmation);
        const queued = await loadCampaign(actor.organizationId, campaign.id);
        const initialRecipients = await transaction
          .select()
          .from(organizationCampaignRecipient)
          .where(eq(organizationCampaignRecipient.campaignId, campaign.id));
        expect(queued.status).toBe("queued");
        expect(initialRecipients).toHaveLength(1);
        await updateAudience(actor, {
          audienceId: campaign.audienceId,
          organizationId: actor.organizationId,
          unsubscribePolicy: {
            kind: "custom",
            urlTemplate:
              "https://changed.example.com/unsubscribe?token={{unsubscribe_token}}",
          },
        });
        const repeated = await sendCampaign(actor, confirmation);
        const stored = await loadCampaign(actor.organizationId, campaign.id);
        expect(repeated.id).toBe(campaign.id);
        expect(stored.unsubscribeSnapshot).toStrictEqual(
          queued.unsubscribeSnapshot
        );
        const recipients = await transaction
          .select()
          .from(organizationCampaignRecipient)
          .where(eq(organizationCampaignRecipient.campaignId, campaign.id));
        expect(recipients.map((recipient) => recipient.id)).toStrictEqual(
          initialRecipients.map((recipient) => recipient.id)
        );
        const [recipient] = recipients;
        if (recipient === undefined || stored.unsubscribeSnapshot === null) {
          throw new Error(
            "The queued campaign has no frozen recipient policy."
          );
        }
        const rendered = renderCampaignEmail({
          html: stored.html,
          text: stored.text,
          token: recipient.unsubscribeToken,
          unsubscribe: stored.unsubscribeSnapshot,
        });
        const frozenUrl = `https://audience.example.com/leave/${recipient.unsubscribeToken}`;
        expect(rendered.headers["List-Unsubscribe"]).toBe(`<${frozenUrl}>`);
        expect(rendered.text).toContain(frozenUrl);
        expect(rendered.text).not.toContain("changed.example.com");
      });
    });

    test("an API key without campaign write scope cannot persist a draft", async () => {
      await withRollbackFixture(async ({ actor, draftInput, transaction }) => {
        await expect(
          createCampaign(
            {
              apiKeyId: randomUUID(),
              organizationId: actor.organizationId,
              scopes: ["campaigns:read"],
            },
            draftInput
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const campaigns = await transaction
          .select({ id: organizationCampaign.id })
          .from(organizationCampaign)
          .where(eq(organizationCampaign.organizationId, actor.organizationId));
        expect(campaigns).toHaveLength(0);
      });
    });

    test("local HTTP development can review and queue the same managed destination", async () => {
      const originalOrigin = state.managedOrigin;
      state.managedOrigin = "http://127.0.0.1:3000";
      try {
        await withRollbackFixture(async ({ actor, draftInput }) => {
          const campaign = await createCampaign(actor, {
            ...draftInput,
            unsubscribeOverride: { kind: "managed" },
          });
          const review = await previewCampaign(actor, {
            campaignId: campaign.id,
            organizationId: actor.organizationId,
          });
          await sendCampaign(
            actor,
            campaignSendInputSchema.parse({
              campaignId: campaign.id,
              confirmed: true,
              expectedUpdatedAt: campaign.updatedAt,
              idempotencyKey: randomUUID(),
              organizationId: actor.organizationId,
              previewToken: review.previewToken,
            })
          );
          const queued = await loadCampaign(actor.organizationId, campaign.id);
          expect(queued.status).toBe("queued");
          expect(queued.unsubscribeSnapshot).toStrictEqual(review.unsubscribe);
          expect(review.message.text).toMatch(/https:\/\//u);
          expect(review.message.text).not.toContain("http://127.0.0.1");
        });
      } finally {
        state.managedOrigin = originalOrigin;
      }
    });

    test("a queued token unsubscribes only its own audience and repeated requests converge", async () => {
      await withRollbackFixture(async ({ actor, draftInput, transaction }) => {
        const campaign = await createCampaign(actor, draftInput);
        const review = await previewCampaign(actor, {
          campaignId: campaign.id,
          organizationId: actor.organizationId,
        });
        await sendCampaign(
          actor,
          campaignSendInputSchema.parse({
            campaignId: campaign.id,
            confirmed: true,
            expectedUpdatedAt: campaign.updatedAt,
            idempotencyKey: randomUUID(),
            organizationId: actor.organizationId,
            previewToken: review.previewToken,
          })
        );
        const [recipient] = await transaction
          .select()
          .from(organizationCampaignRecipient)
          .where(eq(organizationCampaignRecipient.campaignId, campaign.id));
        if (recipient === undefined) {
          throw new Error("The queued campaign has no recipient.");
        }
        const otherAudienceId = randomUUID();
        const otherMembershipId = randomUUID();
        const now = new Date();
        await transaction.insert(organizationAudience).values({
          createdAt: now,
          id: otherAudienceId,
          name: "Other synthetic audience",
          organizationId: actor.organizationId,
          updatedAt: now,
        });
        await transaction.insert(organizationAudienceMembership).values({
          audienceId: otherAudienceId,
          consentOccurredAt: now,
          consentSource: "Synthetic rollback verification",
          contactId: recipient.contactId,
          createdAt: now,
          id: otherMembershipId,
          lastLifecycleOccurredAt: now,
          organizationId: actor.organizationId,
          status: "subscribed",
          tags: [],
          updatedAt: now,
        });
        await unsubscribeCampaignRecipient(recipient.unsubscribeToken);
        await unsubscribeCampaignRecipient(recipient.unsubscribeToken);
        const memberships = await transaction
          .select({
            id: organizationAudienceMembership.id,
            status: organizationAudienceMembership.status,
          })
          .from(organizationAudienceMembership)
          .where(
            eq(
              organizationAudienceMembership.organizationId,
              actor.organizationId
            )
          );
        expect(memberships).toContainEqual({
          id: recipient.membershipId,
          status: "unsubscribed",
        });
        expect(memberships).toContainEqual({
          id: otherMembershipId,
          status: "subscribed",
        });
        const events = await transaction
          .select({ id: organizationAudienceLifecycleEvent.id })
          .from(organizationAudienceLifecycleEvent)
          .where(
            and(
              eq(
                organizationAudienceLifecycleEvent.membershipId,
                recipient.membershipId
              ),
              eq(organizationAudienceLifecycleEvent.eventType, "unsubscribed")
            )
          );
        expect(events).toHaveLength(1);
        const suppressions = await transaction
          .select({ recipient: organizationMailRecipientSuppression.recipient })
          .from(organizationMailRecipientSuppression)
          .where(
            eq(
              organizationMailRecipientSuppression.organizationId,
              actor.organizationId
            )
          );
        expect(suppressions).toHaveLength(0);
      });
    });
  }
);
