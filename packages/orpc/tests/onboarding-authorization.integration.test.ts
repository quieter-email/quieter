import { db } from "@quieter/database/client";
import { member, organization, user } from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { ensureUserOrganizationState } from "../../auth/src/organization";
import {
  completeOnboarding,
  getOnboardingState,
} from "../src/onboarding/service";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});

describe.skipIf(state.databaseUrl === undefined)(
  "onboarding team authorization",
  () => {
    const userIds: string[] = [];
    const organizationIds: string[] = [];
    const acceptedAt = new Date("2026-01-01T00:00:00Z");

    beforeAll(() => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Onboarding integration requires loopback quieter_migration_test."
        );
      }
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, organizationIds));
      await db.delete(user).where(inArray(user.id, userIds));
      await db.$client.end();
    });

    const createFixture = async (role: string, completed = false) => {
      const userId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      userIds.push(userId);
      organizationIds.push(organizationId);
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.test`,
        emailVerified: true,
        id: userId,
        name: "Original reader",
        onboardingCompletedAt: completed ? acceptedAt : null,
        termsAcceptedAt: acceptedAt,
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Alpha team",
        slug: organizationId,
      });
      await db.insert(member).values({
        createdAt: now,
        id: crypto.randomUUID(),
        organizationId,
        role,
        userId,
      });
      return { organizationId, userId };
    };

    test.each([false, true])(
      "rejects member renames, including replay after completion %s",
      async (completed) => {
        const fixture = await createFixture("member", completed);
        await expect(
          completeOnboarding({
            name: "Changed reader",
            teamName: "  Changed team  ",
            userId: fixture.userId,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const [savedTeam] = await db
          .select()
          .from(organization)
          .where(eq(organization.id, fixture.organizationId));
        const [savedUser] = await db
          .select()
          .from(user)
          .where(eq(user.id, fixture.userId));
        expect(savedTeam).toMatchObject({
          name: "Alpha team",
          slug: fixture.organizationId,
        });
        expect(savedUser).toMatchObject({
          name: "Original reader",
          onboardingCompletedAt: completed ? acceptedAt : null,
          termsAcceptedAt: acceptedAt,
        });
      }
    );

    test("keeps first-time team provisioning compatible with onboarding", async () => {
      const userId = crypto.randomUUID();
      userIds.push(userId);
      const identity = {
        email: `${userId}@example.test`,
        id: userId,
        name: "New reader",
      };
      const now = new Date();
      await db.insert(user).values({
        ...identity,
        createdAt: now,
        emailVerified: true,
        updatedAt: now,
      });
      const provisioned = await ensureUserOrganizationState(identity);
      organizationIds.push(...provisioned.organizationIds);
      await completeOnboarding({
        name: identity.name,
        teamName: "New reader team",
        userId,
      });
      await expect(getOnboardingState(userId)).resolves.toMatchObject({
        isComplete: true,
        teamName: "New reader team",
      });
    });

    test.each(["superadmin", "ownerish", "member,administrator"])(
      "rejects roles without manager authority %s",
      async (role) => {
        const fixture = await createFixture(role);
        await expect(
          completeOnboarding({
            name: "New reader",
            teamName: "Changed team",
            userId: fixture.userId,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    );

    test.each([undefined, "", "  ", "  Alpha team  "])(
      "allows member completion without a rename %s",
      async (teamName) => {
        const fixture = await createFixture("member");
        await completeOnboarding({
          name: "  New reader  ",
          teamName,
          userId: fixture.userId,
        });
        const [savedUser] = await db
          .select()
          .from(user)
          .where(eq(user.id, fixture.userId));
        expect(savedUser).toMatchObject({
          name: "New reader",
          termsAcceptedAt: acceptedAt,
        });
        expect(savedUser?.onboardingCompletedAt).toBeInstanceOf(Date);
        const [savedTeam] = await db
          .select()
          .from(organization)
          .where(eq(organization.id, fixture.organizationId));
        expect(savedTeam?.name).toBe("Alpha team");
      }
    );

    test.each(["owner", "admin", "member, ADMIN", " Owner ,member"])(
      "preserves settings manager role %s",
      async (role) => {
        const fixture = await createFixture(role);
        await completeOnboarding({
          name: "New reader",
          teamName: "  Renamed team  ",
          userId: fixture.userId,
        });
        const [savedTeam] = await db
          .select()
          .from(organization)
          .where(eq(organization.id, fixture.organizationId));
        expect(savedTeam).toMatchObject({
          name: "Renamed team",
          slug: fixture.organizationId,
        });
        const onboarding = await getOnboardingState(fixture.userId);
        expect(onboarding).toMatchObject({
          isComplete: true,
          organizationId: fixture.organizationId,
          teamName: "Renamed team",
        });
      }
    );

    test("checks the selected team even when the member owns another team", async () => {
      const fixture = await createFixture("member");
      const otherId = crypto.randomUUID();
      organizationIds.push(otherId);
      await db.insert(organization).values({
        createdAt: new Date(),
        id: otherId,
        name: "Zulu team",
        slug: otherId,
      });
      await db.insert(member).values({
        createdAt: new Date(),
        id: crypto.randomUUID(),
        organizationId: otherId,
        role: "owner",
        userId: fixture.userId,
      });
      await expect(getOnboardingState(fixture.userId)).resolves.toMatchObject({
        organizationId: fixture.organizationId,
      });
      await expect(
        completeOnboarding({
          name: "New reader",
          teamName: "Renamed team",
          userId: fixture.userId,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await db
        .update(organization)
        .set({ name: "Aardvark team" })
        .where(eq(organization.id, otherId));
      await expect(getOnboardingState(fixture.userId)).resolves.toMatchObject({
        organizationId: otherId,
      });
      await completeOnboarding({
        name: "New reader",
        teamName: "Renamed team",
        userId: fixture.userId,
      });
      const [untouched] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, fixture.organizationId));
      expect(untouched?.name).toBe("Alpha team");
      const [renamed] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, otherId));
      expect(renamed?.name).toBe("Renamed team");
    });
  }
);
