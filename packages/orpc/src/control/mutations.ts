import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type {
  DatabaseClient,
  DatabaseTransaction,
} from "@quieter/database/client";
import {
  managementMutation,
  managementMutationAuditEvent,
  member,
  organization,
  session,
  user,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { assertUserCanManageOrganizationSettings } from "../mail-domain/service";
import { setOrganizationMailTrackingSettings } from "../organization-mail-delivery";
import { authenticateControlRequest } from "./authority";
import type { ControlAuthorizationServices, ControlSession } from "./authority";
import { controlContracts, controlErrorSchema } from "./contracts";
import type { ControlResult } from "./contracts";
import {
  controlMutationPrepareSchema,
  controlMutationReviewSchema,
  fingerprintControlMutationRequest,
} from "./mutation-contracts";
import type {
  ControlMutationPatch,
  ControlMutationReview,
} from "./mutation-contracts";
import type { ControlRequestContext } from "./runtime";

type MutationRow = typeof managementMutation.$inferSelect;
type AuditEvent = typeof managementMutationAuditEvent.$inferInsert;
type SafeFailure = z.infer<typeof controlErrorSchema>["error"];
type SettingsReceipt = ControlResult<"organization.settings.update">;
type PinnedAuthority = {
  organizationName: string;
  sessionExpiresAt: Date;
};
type MutationRequest = {
  organizationId: string;
  patch: ControlMutationPatch;
  requestHash: string;
};

const failureMessages = {
  BAD_REQUEST: "Invalid management request.",
  CANCELLED: "The management request was cancelled.",
  CONFLICT: "This change cannot be completed. Review it and try again.",
  FORBIDDEN: "You cannot manage these team settings.",
  INTERNAL_ERROR: "The change could not be completed. Try again.",
  NOT_FOUND: "This change is not available.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  REAUTHENTICATION_REQUIRED: "Sign in again to continue.",
  UNAUTHORIZED: "Sign in again to continue.",
  UNSUPPORTED_OPERATION: "This management operation is not available.",
} satisfies Record<SafeFailure["code"], string>;

const safeFailure = (error: unknown): SafeFailure => {
  const parsed = controlErrorSchema.shape.error.shape.code.safeParse(
    error instanceof ORPCError ? error.code : "INTERNAL_ERROR"
  );
  const code = parsed.success ? parsed.data : "INTERNAL_ERROR";
  return { code, message: failureMessages[code] };
};

const parseParameters = <Schema extends z.ZodType>(
  schema: Schema,
  parameters: unknown
): z.output<Schema> => {
  const parsed = schema.safeParse(parameters);
  if (!parsed.success) {
    throw new ORPCError("BAD_REQUEST");
  }
  return parsed.data;
};

const assertSameRequest = (row: MutationRow, request: MutationRequest) => {
  if (
    row.operation !== "organization.settings.update" ||
    row.organizationId !== request.organizationId ||
    row.requestHash !== request.requestHash ||
    Object.hasOwn(row.parameters, "allowPerSendOverride") !==
      Object.hasOwn(request.patch, "allowPerSendOverride") ||
    Object.hasOwn(row.parameters, "openTrackingEnabled") !==
      Object.hasOwn(request.patch, "openTrackingEnabled") ||
    row.parameters.allowPerSendOverride !==
      request.patch.allowPerSendOverride ||
    row.parameters.openTrackingEnabled !== request.patch.openTrackingEnabled
  ) {
    throw new ORPCError("CONFLICT");
  }
};

const toReview = (
  row: MutationRow,
  organizationName: string
): ControlMutationReview => {
  const base = {
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    id: row.id,
    operation: row.operation,
    organizationId: row.organizationId,
    organizationName,
    patch: row.parameters,
    reviewPath: `/control/review?approvalId=${row.id}`,
    status: row.status,
  };
  switch (row.status) {
    case "prepared": {
      return controlMutationReviewSchema.parse(base);
    }
    case "approved": {
      return controlMutationReviewSchema.parse({
        ...base,
        approvedAt: row.approvedAt?.toISOString(),
      });
    }
    case "succeeded": {
      return controlMutationReviewSchema.parse({
        ...base,
        approvedAt: row.approvedAt?.toISOString(),
        completedAt: row.completedAt?.toISOString(),
        result: row.result,
      });
    }
    case "failed": {
      if (row.errorCode === null) {
        throw new ORPCError("INTERNAL_ERROR");
      }
      return controlMutationReviewSchema.parse({
        ...base,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString(),
        error: {
          code: row.errorCode,
          message: failureMessages[row.errorCode],
        },
      });
    }
    case "cancelled":
    case "expired": {
      return controlMutationReviewSchema.parse({
        ...base,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString(),
      });
    }
    default: {
      const exhaustive: never = row.status;
      throw new Error("Invalid management mutation state.", {
        cause: exhaustive,
      });
    }
  }
};

const toReceipt = (row: MutationRow): SettingsReceipt => {
  const base = {
    completedAt: row.completedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    operationId: row.id,
  };
  switch (row.status) {
    case "succeeded": {
      return controlContracts["organization.settings.update"].output.parse({
        ...base,
        result: row.result,
        state: "succeeded",
      });
    }
    case "cancelled": {
      return controlContracts["organization.settings.update"].output.parse({
        ...base,
        state: "cancelled",
      });
    }
    case "failed": {
      if (row.errorCode === null) {
        throw new ORPCError("INTERNAL_ERROR");
      }
      return controlContracts["organization.settings.update"].output.parse({
        ...base,
        error: {
          code: row.errorCode,
          message: failureMessages[row.errorCode],
        },
        state: "failed",
      });
    }
    case "prepared":
    case "approved":
    case "expired": {
      throw new ORPCError("CONFLICT");
    }
    default: {
      const exhaustive: never = row.status;
      throw new Error("Invalid management mutation state.", {
        cause: exhaustive,
      });
    }
  }
};

const findByIdentity = async (input: {
  actor: ControlSession;
  idempotencyKey: string;
  lock: boolean;
  tx: DatabaseTransaction;
}) => {
  const query = input.tx
    .select()
    .from(managementMutation)
    .where(
      and(
        eq(managementMutation.actorUserId, input.actor.userId),
        eq(managementMutation.credentialKind, "session"),
        eq(managementMutation.credentialId, input.actor.sessionId),
        eq(managementMutation.idempotencyKey, input.idempotencyKey)
      )
    );
  const [row] = await (input.lock
    ? query.for("update", { noWait: true })
    : query);
  return row;
};

export const createControlMutationService = (
  options: {
    clock?: () => Date;
    database?: DatabaseClient;
    sessionServices?: Pick<ControlAuthorizationServices, "getSession">;
  } = {}
) => {
  const database = options.database ?? db;
  const clock = options.clock ?? (() => new Date());

  const audit = async (
    transaction: DatabaseTransaction,
    actor: ControlSession,
    event: Pick<AuditEvent, "eventKind" | "outcomeCode"> & {
      row?: MutationRow;
    }
  ) => {
    await transaction.insert(managementMutationAuditEvent).values({
      actorUserId: actor.userId,
      createdAt: clock(),
      credentialId: actor.sessionId,
      credentialKind: "session",
      eventKind: event.eventKind,
      id: randomUUID(),
      mutationId: event.row?.id ?? null,
      operation: "organization.settings.update",
      organizationId: event.row?.organizationId ?? null,
      outcomeCode: event.outcomeCode,
    });
  };

  const transaction = async <Result>(
    context: ControlRequestContext,
    run: (tx: DatabaseTransaction) => Promise<Result>
  ): Promise<Result> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (context.signal?.aborted === true) {
        throw new ORPCError("CANCELLED");
      }
      try {
        return await database.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '250ms'`);
          return await run(tx);
        });
      } catch (error) {
        let current: unknown = error;
        let rolledBackConflict = false;
        for (let depth = 0; depth < 5; depth += 1) {
          if (typeof current !== "object" || current === null) {
            break;
          }
          if (
            "code" in current &&
            (current.code === "55P03" ||
              current.code === "40P01" ||
              current.code === "40001")
          ) {
            rolledBackConflict = true;
            break;
          }
          current = "cause" in current ? current.cause : null;
        }
        if (context.signal?.aborted ?? false) {
          throw new ORPCError("CANCELLED");
        }
        if (!rolledBackConflict) {
          throw error;
        }
        if (attempt === 2) {
          throw new ORPCError("CONFLICT");
        }
      }
    }
    throw new ORPCError("CONFLICT");
  };

  const authenticated = async <Result>(
    context: ControlRequestContext,
    run: (actor: ControlSession) => Promise<Result>
  ): Promise<Result> => {
    const resolvedSession = await authenticateControlRequest(
      context.headers,
      options.sessionServices
    );
    const actor = {
      expiresAt: new Date(resolvedSession.expiresAt),
      sessionId: resolvedSession.sessionId,
      userId: resolvedSession.userId,
    };
    try {
      if (context.signal?.aborted === true) {
        throw new ORPCError("CANCELLED");
      }
      return await run(actor);
    } catch (error) {
      const failure = safeFailure(error);
      if (failure.code === "INTERNAL_ERROR") {
        reportError(new Error("Management mutation attempt failed."), {
          operation: "organization.settings.update",
        });
      }
      try {
        await database.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '250ms'`);
          await audit(tx, actor, {
            eventKind:
              failure.code === "UNAUTHORIZED" ||
              failure.code === "FORBIDDEN" ||
              failure.code === "NOT_FOUND"
                ? "denied"
                : "failed",
            outcomeCode: failure.code,
          });
        });
      } catch {
        reportError(new Error("Management mutation failure audit failed."), {
          operation: "organization.settings.update",
        });
        throw new ORPCError("INTERNAL_ERROR", {
          message: failureMessages.INTERNAL_ERROR,
        });
      }
      throw new ORPCError(failure.code, { message: failure.message });
    }
  };

  const pinAuthority = async (
    tx: DatabaseTransaction,
    actor: ControlSession,
    organizationId: string
  ): Promise<PinnedAuthority> => {
    const [actorRow] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, actor.userId))
      .for("key share", { noWait: true });
    if (actorRow === undefined) {
      throw new ORPCError("UNAUTHORIZED");
    }
    const [sessionRow] = await tx
      .select({ expiresAt: session.expiresAt })
      .from(session)
      .where(
        and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId))
      )
      .for("share", { noWait: true });
    if (sessionRow === undefined || sessionRow.expiresAt <= clock()) {
      throw new ORPCError("UNAUTHORIZED");
    }
    const [organizationRow] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for("key share", { noWait: true });
    if (organizationRow === undefined) {
      throw new ORPCError("NOT_FOUND");
    }
    const [membership] = await tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, actor.userId)
        )
      )
      .for("share", { noWait: true });
    if (membership === undefined) {
      throw new ORPCError("FORBIDDEN");
    }
    await assertUserCanManageOrganizationSettings(
      { organizationId, userId: actor.userId },
      tx
    );
    return {
      organizationName: organizationRow.name,
      sessionExpiresAt: sessionRow.expiresAt,
    };
  };

  const guardCommit = (input: {
    actor: ControlSession;
    authority: PinnedAuthority;
    context: ControlRequestContext;
    liveMutation?: MutationRow;
  }) => {
    if (input.context.signal?.aborted === true) {
      throw new ORPCError("CANCELLED");
    }
    const now = clock();
    if (
      input.actor.expiresAt <= now ||
      input.authority.sessionExpiresAt <= now
    ) {
      throw new ORPCError("UNAUTHORIZED");
    }
    if (
      input.liveMutation !== undefined &&
      input.liveMutation.expiresAt <= now
    ) {
      throw new ORPCError("CONFLICT");
    }
  };

  const expirePending = async (
    tx: DatabaseTransaction,
    actor: ControlSession,
    row: MutationRow
  ) => {
    if (
      (row.status !== "prepared" && row.status !== "approved") ||
      row.expiresAt > clock()
    ) {
      return row;
    }
    const [expired] = await tx
      .update(managementMutation)
      .set({
        completedAt: clock(),
        status: "expired",
      })
      .where(eq(managementMutation.id, row.id))
      .returning();
    if (expired === undefined) {
      throw new ORPCError("INTERNAL_ERROR");
    }
    await audit(tx, actor, {
      eventKind: "expired",
      outcomeCode: "EXPIRED",
      row: expired,
    });
    return expired;
  };

  const reviewAction = async (input: {
    action: "review" | "approve" | "cancel";
    context: ControlRequestContext;
    id: string;
  }): Promise<ControlMutationReview> =>
    await authenticated(input.context, async (actor) => {
      const id = parseParameters(z.uuid(), input.id);
      return await transaction(input.context, async (tx) => {
        const scope = and(
          eq(managementMutation.id, id),
          eq(managementMutation.actorUserId, actor.userId),
          eq(managementMutation.credentialKind, "session"),
          eq(managementMutation.credentialId, actor.sessionId)
        );
        const [preliminary] = await tx
          .select({ organizationId: managementMutation.organizationId })
          .from(managementMutation)
          .where(scope);
        if (preliminary === undefined) {
          throw new ORPCError("NOT_FOUND");
        }
        const authority = await pinAuthority(
          tx,
          actor,
          preliminary.organizationId
        );
        const [locked] = await tx
          .select()
          .from(managementMutation)
          .where(scope)
          .for("update", { noWait: true });
        if (
          locked === undefined ||
          locked.organizationId !== preliminary.organizationId
        ) {
          throw new ORPCError("NOT_FOUND");
        }
        let row =
          input.action === "cancel"
            ? locked
            : await expirePending(tx, actor, locked);
        if (input.action === "approve" && row.status === "prepared") {
          const approvedAt = clock();
          if (approvedAt >= row.expiresAt) {
            throw new ORPCError("CONFLICT");
          }
          const [approved] = await tx
            .update(managementMutation)
            .set({ approvedAt, status: "approved" })
            .where(eq(managementMutation.id, row.id))
            .returning();
          if (approved === undefined) {
            throw new ORPCError("INTERNAL_ERROR");
          }
          row = approved;
          await audit(tx, actor, {
            eventKind: "approved",
            outcomeCode: "APPROVED",
            row,
          });
        } else if (
          input.action === "cancel" &&
          (row.status === "prepared" || row.status === "approved")
        ) {
          const [cancelled] = await tx
            .update(managementMutation)
            .set({ completedAt: clock(), status: "cancelled" })
            .where(eq(managementMutation.id, row.id))
            .returning();
          if (cancelled === undefined) {
            throw new ORPCError("INTERNAL_ERROR");
          }
          row = cancelled;
          await audit(tx, actor, {
            eventKind: "cancelled",
            outcomeCode: "CANCELLED",
            row,
          });
        } else if (input.action !== "review") {
          await audit(tx, actor, {
            eventKind: "replayed",
            outcomeCode: "REPLAYED",
            row,
          });
        }
        const result = toReview(row, authority.organizationName);
        guardCommit({
          actor,
          authority,
          context: input.context,
          ...(row.status === "approved" ? { liveMutation: row } : {}),
        });
        return result;
      });
    });

  return {
    approve: async (input: { context: ControlRequestContext; id: string }) =>
      await reviewAction({ ...input, action: "approve" }),
    authorize: async (input: {
      context: ControlRequestContext;
      organizationId: string;
    }): Promise<void> => {
      await authenticated(input.context, async (actor) => {
        const organizationId = parseParameters(
          controlMutationPrepareSchema.shape.organizationId,
          input.organizationId
        );
        await transaction(input.context, async (tx) => {
          const authority = await pinAuthority(tx, actor, organizationId);
          guardCommit({ actor, authority, context: input.context });
        });
      });
    },
    cancel: async (input: { context: ControlRequestContext; id: string }) =>
      await reviewAction({ ...input, action: "cancel" }),
    execute: async (input: {
      context: ControlRequestContext;
      parameters: unknown;
    }): Promise<SettingsReceipt> =>
      await authenticated(input.context, async (actor) => {
        const parameters = parseParameters(
          controlContracts["organization.settings.update"].input,
          input.parameters
        );
        const patch = {
          ...(parameters.allowPerSendOverride === undefined
            ? {}
            : { allowPerSendOverride: parameters.allowPerSendOverride }),
          ...(parameters.openTrackingEnabled === undefined
            ? {}
            : { openTrackingEnabled: parameters.openTrackingEnabled }),
        };
        const request = {
          organizationId: parameters.organizationId,
          patch,
          requestHash: await fingerprintControlMutationRequest({
            organizationId: parameters.organizationId,
            patch,
          }),
        };
        const outcome = await transaction(input.context, async (tx) => {
          const identity = { actor, idempotencyKey: parameters.idempotencyKey };
          const preliminary = await findByIdentity({
            ...identity,
            lock: false,
            tx,
          });
          if (
            preliminary === undefined ||
            preliminary.id !== parameters.approvalId
          ) {
            throw new ORPCError("NOT_FOUND");
          }
          assertSameRequest(preliminary, request);
          const authority = await pinAuthority(
            tx,
            actor,
            request.organizationId
          );
          const locked = await findByIdentity({ ...identity, lock: true, tx });
          if (locked === undefined || locked.id !== parameters.approvalId) {
            throw new ORPCError("NOT_FOUND");
          }
          assertSameRequest(locked, request);
          if (
            locked.status === "succeeded" ||
            locked.status === "failed" ||
            locked.status === "cancelled"
          ) {
            await audit(tx, actor, {
              eventKind: "replayed",
              outcomeCode: "REPLAYED",
              row: locked,
            });
            const receipt = toReceipt(locked);
            guardCommit({ actor, authority, context: input.context });
            return { kind: "completed", receipt } as const;
          }
          const row = await expirePending(tx, actor, locked);
          if (row.status === "expired") {
            guardCommit({ actor, authority, context: input.context });
            return { kind: "expired" } as const;
          }
          if (row.status !== "approved") {
            throw new ORPCError("CONFLICT");
          }
          guardCommit({
            actor,
            authority,
            context: input.context,
            liveMutation: row,
          });
          const result = await setOrganizationMailTrackingSettings(
            {
              ...patch,
              actorUserId: actor.userId,
              organizationId: request.organizationId,
            },
            tx
          );
          guardCommit({
            actor,
            authority,
            context: input.context,
            liveMutation: row,
          });
          const [succeeded] = await tx
            .update(managementMutation)
            .set({ completedAt: clock(), result, status: "succeeded" })
            .where(eq(managementMutation.id, row.id))
            .returning();
          if (succeeded === undefined) {
            throw new ORPCError("INTERNAL_ERROR");
          }
          await audit(tx, actor, {
            eventKind: "executed",
            outcomeCode: "EXECUTED",
            row: succeeded,
          });
          const receipt = toReceipt(succeeded);
          guardCommit({
            actor,
            authority,
            context: input.context,
            liveMutation: row,
          });
          return { kind: "completed", receipt } as const;
        });
        if (outcome.kind === "expired") {
          throw new ORPCError("CONFLICT");
        }
        return outcome.receipt;
      }),
    prepare: async (input: {
      context: ControlRequestContext;
      parameters: unknown;
    }): Promise<ControlMutationReview> =>
      await authenticated(input.context, async (actor) => {
        const parameters = parseParameters(
          controlMutationPrepareSchema,
          input.parameters
        );
        const patch = {
          ...(parameters.allowPerSendOverride === undefined
            ? {}
            : { allowPerSendOverride: parameters.allowPerSendOverride }),
          ...(parameters.openTrackingEnabled === undefined
            ? {}
            : { openTrackingEnabled: parameters.openTrackingEnabled }),
        };
        const request = {
          organizationId: parameters.organizationId,
          patch,
          requestHash: await fingerprintControlMutationRequest({
            organizationId: parameters.organizationId,
            patch,
          }),
        };
        const identity = { actor, idempotencyKey: parameters.idempotencyKey };
        return await transaction(input.context, async (tx) => {
          const preliminary = await findByIdentity({
            ...identity,
            lock: false,
            tx,
          });
          if (preliminary !== undefined) {
            assertSameRequest(preliminary, request);
          }
          const authority = await pinAuthority(
            tx,
            actor,
            request.organizationId
          );
          let row = await findByIdentity({ ...identity, lock: true, tx });
          let inserted = false;
          if (row === undefined) {
            const createdAt = clock();
            [row] = await tx
              .insert(managementMutation)
              .values({
                actorUserId: actor.userId,
                createdAt,
                credentialId: actor.sessionId,
                credentialKind: "session",
                expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1000),
                id: randomUUID(),
                idempotencyKey: parameters.idempotencyKey,
                operation: "organization.settings.update",
                organizationId: request.organizationId,
                parameters: patch,
                requestHash: request.requestHash,
                status: "prepared",
              })
              .onConflictDoNothing({
                target: [
                  managementMutation.actorUserId,
                  managementMutation.credentialKind,
                  managementMutation.credentialId,
                  managementMutation.idempotencyKey,
                ],
              })
              .returning();
            inserted = row !== undefined;
            // A new statement sees an identity claim committed while INSERT waited.
            row ??= await findByIdentity({ ...identity, lock: true, tx });
          }
          if (row === undefined) {
            throw new ORPCError("CONFLICT");
          }
          assertSameRequest(row, request);
          row = await expirePending(tx, actor, row);
          await audit(tx, actor, {
            eventKind: inserted ? "prepared" : "replayed",
            outcomeCode: inserted ? "PREPARED" : "REPLAYED",
            row,
          });
          const result = toReview(row, authority.organizationName);
          guardCommit({ actor, authority, context: input.context });
          return result;
        });
      }),
    review: async (input: { context: ControlRequestContext; id: string }) =>
      await reviewAction({ ...input, action: "review" }),
  };
};

export type ControlMutationService = ReturnType<
  typeof createControlMutationService
>;
