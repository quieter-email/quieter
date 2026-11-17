/// <reference types="vite/client" />

import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { ControlAuthorizationServices } from "../src/control/authority";
import type { ControlMutationReview } from "../src/control/mutation-contracts";
import type { createControlMutationService } from "../src/control/mutations";
import { createControlMutationNativeFixture } from "./helpers/control-mutation-native";

type Fixture = Awaited<ReturnType<typeof createControlMutationNativeFixture>>;
type MutationService = ReturnType<typeof createControlMutationService>;

const waitFor = async (condition: () => Promise<boolean>) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(5);
  }
  throw new Error("The intended native lock wait was not observed.");
};

describe.runIf(import.meta.env.MODE === "control-native")(
  "native management mutations",
  () => {
    let fixture: Fixture | undefined;
    let createService: typeof createControlMutationService;
    let service: MutationService;
    const getSession = vi.fn<ControlAuthorizationServices["getSession"]>();
    const context = {
      headers: new Headers({ cookie: "native-control=session" }),
    };
    const parameters = {
      idempotencyKey: "native-request",
      openTrackingEnabled: true,
      organizationId: "native-team",
    };

    beforeAll(async () => {
      fixture = await createControlMutationNativeFixture();
      const loaded = await import("../src/control/mutations");
      createService = loaded.createControlMutationService;
    }, 120_000);

    beforeEach(async () => {
      if (fixture === undefined) {
        throw new Error("Native fixture is unavailable.");
      }
      await fixture.sql`truncate "user" cascade`;
      const now = new Date();
      await fixture.sql`
      insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt","defaultOrganizationProvisioned") values
      ('native-user','Native actor','native@example.test',true,${now.toISOString()},${now.toISOString()},true),
      ('other-user','Other actor','other@example.test',true,${now.toISOString()},${now.toISOString()},true)
    `;
      await fixture.sql`
      insert into organization (id,name,slug,"createdAt") values
      ('native-team','Native team','native-team',${now.toISOString()}),
      ('second-team','Second team','second-team',${now.toISOString()}),
      ('foreign-team','Foreign team','foreign-team',${now.toISOString()})
    `;
      await fixture.sql`
      insert into member (id,"organizationId","userId",role,"createdAt") values
      ('native-member','native-team','native-user','admin',${now.toISOString()}),
      ('second-member','second-team','native-user','owner',${now.toISOString()}),
      ('foreign-member','foreign-team','other-user','owner',${now.toISOString()})
    `;
      await fixture.sql`
      insert into session (id,"userId",token,"createdAt","updatedAt","expiresAt") values
      ('native-session','native-user','fixture-token-a',${now.toISOString()},${now.toISOString()},${new Date(now.getTime() + 86_400_000).toISOString()}),
      ('other-session','other-user','fixture-token-b',${now.toISOString()},${now.toISOString()},${new Date(now.getTime() + 86_400_000).toISOString()}),
      ('replacement-session','native-user','fixture-token-c',${now.toISOString()},${now.toISOString()},${new Date(now.getTime() + 86_400_000).toISOString()})
    `;
      await fixture.sql`
      insert into "organizationMailTrackingSettings" ("organizationId","openTrackingEnabled","allowPerSendOverride","createdAt","updatedAt")
      values ('native-team',false,true,${now.toISOString()},${now.toISOString()})
    `;
      getSession.mockReset().mockResolvedValue({
        expiresAt: new Date(now.getTime() + 86_400_000),
        sessionId: "native-session",
        userId: "native-user",
      });
      service = createService({
        database: fixture.database,
        sessionServices: { getSession },
      });
    });

    afterAll(async () => {
      if (fixture !== undefined) {
        await fixture.cleanup();
        process.stdout.write(
          `${await readFile(fixture.resourcePath, "utf8")}\n`
        );
      }
    }, 15_000);

    const prepareApproved = async (
      selected = service
    ): Promise<ControlMutationReview> => {
      const prepared = await selected.prepare({ context, parameters });
      expect(prepared.status).toBe("prepared");
      return await selected.approve({ context, id: prepared.id });
    };

    test("prepares without changing settings, requires approval, then commits real setter and receipt/audit", async () => {
      if (!fixture) {
        throw new Error("Native fixture is unavailable.");
      }
      const prepared = await service.prepare({ context, parameters });
      await expect(
        service.execute({
          context,
          parameters: { ...parameters, approvalId: prepared.id },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const [before] =
        await fixture.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
      expect(before).toMatchObject({ openTrackingEnabled: false });
      await service.approve({ context, id: prepared.id });
      const receipt = await service.execute({
        context,
        parameters: { ...parameters, approvalId: prepared.id },
      });
      expect(receipt).toMatchObject({
        result: { allowPerSendOverride: true, openTrackingEnabled: true },
        state: "succeeded",
      });
      const [stored] =
        await fixture.sql`select status,result,parameters from "managementMutation" where id=${prepared.id}`;
      expect(stored?.status).toBe("succeeded");
      expect(stored?.parameters).not.toHaveProperty("allowPerSendOverride");
      const [audit] =
        await fixture.sql`select count(*)::int as count from "managementMutationAuditEvent" where "mutationId"=${prepared.id} and "eventKind"='executed'`;
      expect(audit?.count).toBe(1);
    });

    test("binds key to exact organization and patch presence and keeps approval immutable", async () => {
      if (!fixture) {
        throw new Error("Native fixture is unavailable.");
      }
      const approved = await prepareApproved();
      await expect(
        service.prepare({
          context,
          parameters: { ...parameters, organizationId: "second-team" },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        service.execute({
          context,
          parameters: {
            ...parameters,
            allowPerSendOverride: false,
            approvalId: approved.id,
          },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const repeated = await service.approve({ context, id: approved.id });
      expect(repeated).toMatchObject({ id: approved.id, status: "approved" });
      if (approved.status !== "approved" || repeated.status !== "approved") {
        throw new Error("Expected approved state.");
      }
      expect(repeated.approvedAt).toBe(approved.approvedAt);
      const [settings] =
        await fixture.sql`select "openTrackingEnabled","allowPerSendOverride" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
      expect(settings).toMatchObject({
        allowPerSendOverride: true,
        openTrackingEnabled: false,
      });
    });

    test("keeps other actor and replacement session outside an existing approval", async () => {
      if (!fixture) {
        throw new Error("Native fixture is unavailable.");
      }
      const approved = await prepareApproved();
      for (const identity of [
        { sessionId: "other-session", userId: "other-user" },
        { sessionId: "replacement-session", userId: "native-user" },
      ]) {
        getSession.mockResolvedValue({
          ...identity,
          expiresAt: new Date(Date.now() + 86_400_000),
        });
        await expect(
          service.review({ context, id: approved.id })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          service.execute({
            context,
            parameters: { ...parameters, approvalId: approved.id },
          })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      const [row] =
        await fixture.sql`select status from "managementMutation" where id=${approved.id}`;
      expect(row?.status).toBe("approved");
    });

    test.each(["expired", "deleted", "reassigned"])(
      "revalidates actual SQL session after trusted authentication, %s",
      async (change) => {
        if (!fixture) {
          throw new Error("Native fixture is unavailable.");
        }
        const approved = await prepareApproved();
        if (change === "expired") {
          await fixture.sql`update session set "expiresAt"=${new Date(Date.now() - 1000).toISOString()} where id='native-session'`;
        } else if (change === "deleted") {
          await fixture.sql`delete from session where id='native-session'`;
        } else {
          await fixture.sql`update session set "userId"='other-user' where id='native-session'`;
        }
        await expect(
          service.execute({
            context,
            parameters: { ...parameters, approvalId: approved.id },
          })
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        const [row] =
          await fixture.sql`select status from "managementMutation" where id=${approved.id}`;
        expect(row?.status).toBe("approved");
      }
    );

    test.each(["downgraded", "deleted"])(
      "revalidates membership %s and commits denial audit outside rollback",
      async (change) => {
        if (!fixture) {
          throw new Error("Native fixture is unavailable.");
        }
        const approved = await prepareApproved();
        if (change === "downgraded") {
          await fixture.sql`update member set role='member' where id='native-member'`;
        } else {
          await fixture.sql`delete from member where id='native-member'`;
        }
        await expect(
          service.execute({
            context,
            parameters: { ...parameters, approvalId: approved.id },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const rows =
          await fixture.sql`select "organizationId","mutationId" from "managementMutationAuditEvent" where "eventKind"='denied'`;
        expect(rows).toContainEqual(
          expect.objectContaining({ mutationId: null, organizationId: null })
        );
        const [settings] =
          await fixture.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
        expect(settings).toMatchObject({ openTrackingEnabled: false });
      }
    );

    test("uses canonical role parsing and never records an unvalidated foreign target", async () => {
      if (!fixture) {
        throw new Error("Native fixture is unavailable.");
      }
      await fixture.sql`update member set role='member, Admin' where id='native-member'`;
      await expect(
        service.prepare({ context, parameters })
      ).resolves.toMatchObject({ status: "prepared" });
      await expect(
        service.prepare({
          context,
          parameters: {
            ...parameters,
            idempotencyKey: "foreign",
            organizationId: "foreign-team",
          },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const [leak] =
        await fixture.sql`select count(*)::int as count from "managementMutationAuditEvent" where "organizationId"='foreign-team'`;
      expect(leak?.count).toBe(0);
    });

    test("cancel is terminal and never undoes a successful command", async () => {
      if (!fixture) {
        throw new Error("Native fixture is unavailable.");
      }
      const approved = await prepareApproved();
      await expect(
        service.cancel({ context, id: approved.id })
      ).resolves.toMatchObject({ status: "cancelled" });
      await expect(
        service.execute({
          context,
          parameters: { ...parameters, approvalId: approved.id },
        })
      ).resolves.toMatchObject({ state: "cancelled" });
      const next = { ...parameters, idempotencyKey: "successful-request" };
      const prepared = await service.prepare({ context, parameters: next });
      await service.approve({ context, id: prepared.id });
      await service.execute({
        context,
        parameters: { ...next, approvalId: prepared.id },
      });
      await expect(
        service.cancel({ context, id: prepared.id })
      ).resolves.toMatchObject({ status: "succeeded" });
      const [settings] =
        await fixture.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
      expect(settings).toMatchObject({ openTrackingEnabled: true });
    });

    test("recovers a discarded success receipt before expiry checks without reapplying later settings", async () => {
      if (!fixture) {
        throw new Error("Native fixture is unavailable.");
      }
      let now = new Date();
      const selected = createService({
        clock: () => now,
        database: fixture.database,
        sessionServices: { getSession },
      });
      const approved = await prepareApproved(selected);
      await selected.execute({
        context,
        parameters: { ...parameters, approvalId: approved.id },
      });
      const { setOrganizationMailTrackingSettings } =
        await import("../src/organization-mail-delivery");
      await setOrganizationMailTrackingSettings(
        {
          actorUserId: "native-user",
          openTrackingEnabled: false,
          organizationId: "native-team",
        },
        fixture.database
      );
      now = new Date(now.getTime() + 3_600_000);
      await expect(
        selected.execute({
          context,
          parameters: { ...parameters, approvalId: approved.id },
        })
      ).resolves.toMatchObject({
        result: { allowPerSendOverride: true, openTrackingEnabled: true },
        state: "succeeded",
      });
      const [settings] =
        await fixture.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
      expect(settings).toMatchObject({ openTrackingEnabled: false });
      const [executions] =
        await fixture.sql`select count(*)::int as count from "managementMutationAuditEvent" where "mutationId"=${approved.id} and "eventKind"='executed'`;
      expect(executions?.count).toBe(1);
    });

    test("commits expiry before setter while preserving settings", async () => {
      if (!fixture) {
        throw new Error("Native fixture is unavailable.");
      }
      let now = new Date();
      const selected = createService({
        clock: () => now,
        database: fixture.database,
        sessionServices: { getSession },
      });
      const approved = await prepareApproved(selected);
      now = new Date(now.getTime() + 3_600_000);
      await expect(
        selected.execute({
          context,
          parameters: { ...parameters, approvalId: approved.id },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        selected.review({ context, id: approved.id })
      ).resolves.toMatchObject({ status: "expired" });
      const [settings] =
        await fixture.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
      expect(settings).toMatchObject({ openTrackingEnabled: false });
    });

    test.each(["member", "session"])(
      "uses SHARE rather than KEY SHARE for the %s fence and retries the same identity",
      async (target) => {
        if (!fixture) {
          throw new Error("Native fixture is unavailable.");
        }
        const approved = await prepareApproved();
        await fixture.secondSql.begin(async (blocker) => {
          if (target === "member") {
            await blocker`select id from member where id='native-member' for no key update`;
          } else {
            await blocker`select id from session where id='native-session' for no key update`;
          }
          await expect(
            service.execute({
              context,
              parameters: { ...parameters, approvalId: approved.id },
            })
          ).rejects.toMatchObject({ code: "CONFLICT" });
        });
        await expect(
          service.execute({
            context,
            parameters: { ...parameters, approvalId: approved.id },
          })
        ).resolves.toMatchObject({ state: "succeeded" });
      }
    );

    test("funding trigger holds member then waits for organization without a command lock cycle", async () => {
      if (!fixture) {
        throw new Error("Native fixture is unavailable.");
      }
      const approved = await prepareApproved();
      const [backend] = await fixture.secondSql<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      const observer = await fixture.observer();
      let deletion: Promise<unknown> | undefined;
      try {
        await observer.sql.begin(async (holder) => {
          await holder`select id from organization where id='native-team' for key share`;
          deletion = fixture?.secondSql.begin(async (deleting) => {
            await deleting`delete from member where id='native-member'`;
          });
          await waitFor(async () => {
            await holder`select pg_stat_clear_snapshot()`;
            const [row] =
              await holder`select exists(select 1 from pg_stat_activity where pid=${backend.pid} and wait_event_type='Lock') as waiting`;
            return row?.waiting === true;
          });
          await expect(
            service.execute({
              context,
              parameters: { ...parameters, approvalId: approved.id },
            })
          ).rejects.toMatchObject({ code: "CONFLICT" });
        });
        await deletion;
        await expect(
          service.execute({
            context,
            parameters: { ...parameters, approvalId: approved.id },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await observer.close();
      }
    });

    test.each(["organization", "user"])(
      "handles the %s deletion inverse and retains safe denial audit",
      async (target) => {
        if (!fixture) {
          throw new Error("Native fixture is unavailable.");
        }
        const approved = await prepareApproved();
        await fixture.secondSql.begin(async (deleting) => {
          if (target === "organization") {
            await deleting`select id from organization where id='native-team' for update`;
          } else {
            await deleting`select id from "user" where id='native-user' for update`;
          }
          await expect(
            service.execute({
              context,
              parameters: { ...parameters, approvalId: approved.id },
            })
          ).rejects.toMatchObject({ code: "CONFLICT" });
          if (target === "organization") {
            await deleting`delete from organization where id='native-team'`;
          } else {
            await deleting`delete from "user" where id='native-user'`;
          }
        });
        const [rows] =
          await fixture.sql`select count(*)::int as count from "managementMutation" where id=${approved.id}`;
        expect(rows?.count).toBe(0);
        const [audit] =
          await fixture.sql`select count(*)::int as count from "managementMutationAuditEvent" where "actorUserId"='native-user' and "organizationId" is null and "mutationId" is null`;
        expect(audit?.count).toBeGreaterThan(0);
      }
    );

    test.each([
      { code: "CANCELLED", reason: "abort" },
      { code: "CONFLICT", reason: "approval-expiry" },
      { code: "UNAUTHORIZED", reason: "session-expiry" },
    ])(
      "rolls real setter back when $reason is observed after an actual upsert wait",
      async ({ code, reason }) => {
        if (!fixture) {
          throw new Error("Native fixture is unavailable.");
        }
        let now = new Date();
        const selected = createService({
          clock: () => now,
          database: fixture.database,
          sessionServices: { getSession },
        });
        const approved = await prepareApproved(selected);
        if (reason === "session-expiry") {
          await fixture.sql`update session set "expiresAt"=${new Date(now.getTime() + 60_000).toISOString()} where id='native-session'`;
        }
        const [backend] = await fixture.sql<
          { pid: number }[]
        >`select pg_backend_pid() as pid`;
        const observer = await fixture.observer();
        const controller = new AbortController();
        let execution: Promise<unknown> | undefined;
        try {
          await fixture.secondSql.begin(async (holder) => {
            await holder`select "organizationId" from "organizationMailTrackingSettings" where "organizationId"='native-team' for update`;
            execution = selected
              .execute({
                context: { ...context, signal: controller.signal },
                parameters: { ...parameters, approvalId: approved.id },
              })
              .catch((error: unknown) => error);
            await waitFor(async () => {
              const [row] =
                await observer.sql`select exists(select 1 from pg_stat_activity where pid=${backend.pid} and wait_event_type='Lock') as waiting`;
              return row?.waiting === true;
            });
            if (reason === "abort") {
              controller.abort(new Error("synthetic-private-cancellation"));
            } else {
              now = new Date(
                now.getTime() +
                  (reason === "session-expiry" ? 120_000 : 3_600_000)
              );
            }
          });
          const failure = await execution;
          expect(failure).toMatchObject({ code });
          const [settings] =
            await fixture.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
          expect(settings).toMatchObject({ openTrackingEnabled: false });
          const [row] =
            await fixture.sql`select status from "managementMutation" where id=${approved.id}`;
          expect(row?.status).toBe("approved");
          const [audits] =
            await fixture.sql`select count(*)::int as count from "managementMutationAuditEvent" where "mutationId"=${approved.id} and "eventKind"='executed'`;
          expect(audits?.count).toBe(0);
        } finally {
          await observer.close();
        }
      }
    );

    test("concurrent missing-key claims converge through a fresh statement after INSERT conflict", async () => {
      const native = fixture;
      if (native === undefined) {
        throw new Error("Native fixture is unavailable.");
      }
      const secondService = createService({
        database: native.secondDatabase,
        sessionServices: { getSession },
      });
      await native.sql.unsafe(
        `create function control_native_claim() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(8071941); return new; end $$; create trigger control_native_claim before insert on "managementMutation" for each row execute function control_native_claim()`
      );
      const observer = await native.observer();
      let claims: Promise<unknown>[] = [];
      try {
        await observer.sql`select pg_advisory_lock(8071941)`;
        claims = [
          service.prepare({ context, parameters }),
          secondService.prepare({ context, parameters }),
        ];
        const outcomes = Promise.allSettled(claims);
        await waitFor(async () => {
          const [row] =
            await observer.sql`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%managementMutation%'`;
          return row?.count === 2;
        });
        await observer.sql`select pg_advisory_unlock(8071941)`;
        const results = await outcomes;
        expect(
          results.every((result) => result.status === "fulfilled")
        ).toBeTruthy();
        const repeated = await service.prepare({ context, parameters });
        const other = await secondService.prepare({ context, parameters });
        expect(other.id).toBe(repeated.id);
        const [rows] =
          await native.sql`select count(*)::int as count from "managementMutation" where "actorUserId"='native-user' and "credentialId"='native-session' and "idempotencyKey"=${parameters.idempotencyKey}`;
        expect(rows?.count).toBe(1);
        const [created] =
          await native.sql`select count(*)::int as count from "managementMutationAuditEvent" where "mutationId"=${repeated.id} and "eventKind"='prepared'`;
        expect(created?.count).toBe(1);
      } finally {
        await observer.sql`select pg_advisory_unlock_all()`;
        await Promise.allSettled(claims);
        await observer.close();
        await native.sql.unsafe(
          `drop trigger control_native_claim on "managementMutation"; drop function control_native_claim()`
        );
      }
    }, 15_000);

    test("expiry while success audit waits rolls setter, receipt and executed audit back together", async () => {
      const native = fixture;
      if (native === undefined) {
        throw new Error("Native fixture is unavailable.");
      }
      let now = new Date();
      const selected = createService({
        clock: () => now,
        database: native.database,
        sessionServices: { getSession },
      });
      const approved = await prepareApproved(selected);
      await native.sql.unsafe(
        `create function control_native_audit_wait() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(8071942); return new; end $$; create trigger control_native_audit_wait before insert on "managementMutationAuditEvent" for each row when (new."eventKind"='executed') execute function control_native_audit_wait()`
      );
      const [backend] = await native.sql<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      const observer = await native.observer();
      let execution: Promise<unknown> | undefined;
      try {
        await native.secondSql`select pg_advisory_lock(8071942)`;
        const execute = async () => {
          try {
            return await selected.execute({
              context,
              parameters: { ...parameters, approvalId: approved.id },
            });
          } catch (error) {
            return error;
          }
        };
        execution = execute();
        await waitFor(async () => {
          const [row] =
            await observer.sql`select exists(select 1 from pg_stat_activity where pid=${backend.pid} and wait_event_type='Lock') as waiting`;
          return row?.waiting === true;
        });
        now = new Date(now.getTime() + 3_600_000);
        await native.secondSql`select pg_advisory_unlock(8071942)`;
        await expect(execution).resolves.toMatchObject({ code: "CONFLICT" });
        const [settings] =
          await native.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
        expect(settings).toMatchObject({ openTrackingEnabled: false });
        const [row] =
          await native.sql`select status,result from "managementMutation" where id=${approved.id}`;
        expect(row).toMatchObject({ result: null, status: "approved" });
        const [audit] =
          await native.sql`select count(*)::int as count from "managementMutationAuditEvent" where "mutationId"=${approved.id} and "eventKind"='executed'`;
        expect(audit?.count).toBe(0);
      } finally {
        await native.secondSql`select pg_advisory_unlock_all()`;
        await execution;
        await observer.close();
        await native.sql.unsafe(
          `drop trigger control_native_audit_wait on "managementMutationAuditEvent"; drop function control_native_audit_wait()`
        );
      }
    }, 15_000);

    test("concurrent cancel cannot overwrite a successful execute and retries the same receipt", async () => {
      const native = fixture;
      if (native === undefined) {
        throw new Error("Native fixture is unavailable.");
      }
      const approved = await prepareApproved();
      const [backend] = await native.sql<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;
      const observer = await native.observer();
      const cancelling = createService({
        database: native.secondDatabase,
        sessionServices: { getSession },
      });
      let execution: Promise<unknown> | undefined;
      try {
        await observer.sql.begin(async (holder) => {
          await holder`select "organizationId" from "organizationMailTrackingSettings" where "organizationId"='native-team' for update`;
          execution = service.execute({
            context,
            parameters: { ...parameters, approvalId: approved.id },
          });
          await waitFor(async () => {
            await holder`select pg_stat_clear_snapshot()`;
            const [row] =
              await holder`select exists(select 1 from pg_stat_activity where pid=${backend.pid} and wait_event_type='Lock') as waiting`;
            return row?.waiting === true;
          });
          await expect(
            cancelling.cancel({ context, id: approved.id })
          ).rejects.toMatchObject({ code: "CONFLICT" });
        });
        await expect(execution).resolves.toMatchObject({ state: "succeeded" });
        await expect(
          cancelling.cancel({ context, id: approved.id })
        ).resolves.toMatchObject({ status: "succeeded" });
        const [settings] =
          await native.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
        expect(settings).toMatchObject({ openTrackingEnabled: true });
      } finally {
        await observer.close();
      }
    }, 15_000);

    test("actual HTTP approval and lost response recover the same durable receipt without reapplying", async () => {
      const native = fixture;
      if (native === undefined) {
        throw new Error("Native fixture is unavailable.");
      }
      const [
        { createControlApplicationRuntime },
        { handleControlHttpRequest },
        contracts,
        reviewContracts,
        version,
      ] = await Promise.all([
        import("../src/control/application-runtime"),
        import("../src/control/http"),
        import("../src/control/contracts"),
        import("../src/control/mutation-contracts"),
        import("../src/control/openapi"),
      ]);
      const authorizationServices = {
        assertCalendarAccess: vi
          .fn<ControlAuthorizationServices["assertCalendarAccess"]>()
          .mockResolvedValue(),
        assertOrganizationAccess: vi
          .fn<ControlAuthorizationServices["assertOrganizationAccess"]>()
          .mockResolvedValue(),
        getMailboxAccess: vi
          .fn<ControlAuthorizationServices["getMailboxAccess"]>()
          .mockRejectedValue(new Error("Unexpected mailbox read.")),
        getSession,
      } satisfies ControlAuthorizationServices;
      const runtime = createControlApplicationRuntime({
        authorizationServices,
        mutationService: service,
      });
      let port: number | undefined;
      let dropNextSuccess = false;
      const server = createServer((incoming, outgoing) => {
        void (async () => {
          try {
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (Array.isArray(value)) {
                for (const item of value) {
                  headers.append(name, item);
                }
              } else if (value !== undefined) {
                headers.set(name, value);
              }
            }
            const chunks: Uint8Array[] = [];
            for await (const chunk of incoming) {
              if (!(chunk instanceof Uint8Array)) {
                throw new Error("Unexpected HTTP byte stream.");
              }
              chunks.push(chunk);
            }
            const request = new Request(
              `http://127.0.0.1:${port}${incoming.url ?? "/"}`,
              {
                body:
                  incoming.method === "GET" ? undefined : Buffer.concat(chunks),
                headers,
                method: incoming.method,
              }
            );
            const response = await handleControlHttpRequest(request, {
              runtime,
            });
            if (
              dropNextSuccess &&
              incoming.url === "/api/control/organization.settings.update" &&
              response.status === 200
            ) {
              dropNextSuccess = false;
              outgoing.destroy();
              return;
            }
            outgoing.writeHead(
              response.status,
              Object.fromEntries(response.headers)
            );
            outgoing.end(Buffer.from(await response.arrayBuffer()));
          } catch {
            outgoing.writeHead(500);
            outgoing.end("Native HTTP fixture failed.");
          }
        })();
      });
      const httpResource = path.join(
        path.dirname(native.resourcePath),
        "http-resource.json"
      );
      try {
        const listening = once(server, "listening");
        server.listen(0, "127.0.0.1");
        await listening;
        const address = server.address();
        if (address === null || typeof address === "string") {
          throw new Error("Native HTTP listener unavailable.");
        }
        ({ port } = address);
        const origin = `http://127.0.0.1:${port}`;
        await writeFile(
          httpResource,
          JSON.stringify({
            host: "127.0.0.1",
            nodePid: process.pid,
            port,
            state: "running",
          })
        );
        const request = async (
          operation: string,
          body: unknown,
          extraHeaders: Record<string, string> = {}
        ) =>
          await fetch(`${origin}/api/control/${operation}`, {
            body: JSON.stringify(body),
            headers: {
              "content-type": "application/json",
              cookie: "native-control=session",
              [version.CONTROL_API_VERSION_HEADER]: version.CONTROL_API_VERSION,
              ...extraHeaders,
            },
            method: "POST",
            redirect: "error",
          });
        const preparedResponse = await request("mutations/prepare", parameters);
        expect(preparedResponse.status).toBe(200);
        const prepared = reviewContracts.controlMutationReviewSchema.parse(
          await preparedResponse.json()
        );
        const denied = await request("reviews/approve", { id: prepared.id });
        expect(denied.status).toBe(403);
        const approvedResponse = await request(
          "reviews/approve",
          { id: prepared.id },
          {
            origin,
            "sec-fetch-site": "same-origin",
            [reviewContracts.CONTROL_REVIEW_HEADER]:
              reviewContracts.CONTROL_REVIEW_INTENT,
          }
        );
        const approved = reviewContracts.controlMutationReviewSchema.parse(
          await approvedResponse.json()
        );
        expect(approved.status).toBe("approved");
        const [beforeExecution] =
          await native.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
        expect(beforeExecution).toMatchObject({ openTrackingEnabled: false });
        const executionParameters = { ...parameters, approvalId: prepared.id };
        dropNextSuccess = true;
        await expect(
          request("organization.settings.update", executionParameters)
        ).rejects.toThrow(/fetch failed/u);
        const [committed] =
          await native.sql`select status from "managementMutation" where id=${prepared.id}`;
        expect(committed?.status).toBe("succeeded");
        const { setOrganizationMailTrackingSettings } =
          await import("../src/organization-mail-delivery");
        await setOrganizationMailTrackingSettings(
          {
            actorUserId: "native-user",
            openTrackingEnabled: false,
            organizationId: "native-team",
          },
          native.database
        );
        const replayResponse = await request(
          "organization.settings.update",
          executionParameters
        );
        const replay = contracts.controlContracts[
          "organization.settings.update"
        ].output.parse(await replayResponse.json());
        expect(replay).toMatchObject({
          result: { allowPerSendOverride: true, openTrackingEnabled: true },
          state: "succeeded",
        });
        const [settings] =
          await native.sql`select "openTrackingEnabled" from "organizationMailTrackingSettings" where "organizationId"='native-team'`;
        expect(settings).toMatchObject({ openTrackingEnabled: false });
        const [audits] =
          await native.sql`select count(*)::int as count from "managementMutationAuditEvent" where "mutationId"=${prepared.id} and "eventKind"='executed'`;
        expect(audits?.count).toBe(1);
      } finally {
        if (server.listening) {
          const closed = once(server, "close");
          server.closeAllConnections();
          server.close();
          await closed;
        }
        const receipt = {
          host: "127.0.0.1",
          nodePid: process.pid,
          port,
          state: "stopped",
        };
        await writeFile(httpResource, `${JSON.stringify(receipt)}\n`);
        process.stdout.write(`${JSON.stringify(receipt)}\n`);
      }
    }, 15_000);
  }
);
