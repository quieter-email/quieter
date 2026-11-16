import { ORPCError } from "@orpc/server";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import type { MailboxCapabilities } from "@quieter/mail/data-plane";

import { controlOperations, controlTargetSchema } from "./registry";
import type {
  ControlOperation,
  ControlOperationId,
  ControlScope,
  ControlTarget,
} from "./registry";

export type ControlSession = {
  expiresAt: Date;
  sessionId: string;
  userId: string;
};

export type ControlAuthorizationServices = {
  assertCalendarAccess: (input: {
    connectionId: string;
    userId: string;
  }) => Promise<void>;
  assertOrganizationAccess: (input: {
    manage: boolean;
    organizationId: string;
    userId: string;
  }) => Promise<void>;
  getMailboxAccess: (input: { mailboxId: string; userId: string }) => Promise<{
    capabilities: MailboxCapabilities;
    organizationId: string;
  }>;
  getSession: (headers: Headers) => Promise<ControlSession | null>;
};

const authorizationServices: ControlAuthorizationServices = {
  assertCalendarAccess: async (input) => {
    const { getCalendarAccountForUser } = await import("../calendar/service");
    const account = await getCalendarAccountForUser(input);
    if (account.status === "needs-reconnect") {
      throw new ORPCError("REAUTHENTICATION_REQUIRED", { status: 401 });
    }
    if (account.status !== "connected") {
      throw new ORPCError("FORBIDDEN");
    }
  },
  assertOrganizationAccess: async ({ manage, ...input }) => {
    const {
      assertUserCanManageOrganizationSettings,
      assertUserOrganizationMember,
    } = await import("../mail-domain/service");
    if (manage) {
      await assertUserCanManageOrganizationSettings(input);
    } else {
      await assertUserOrganizationMember(input);
    }
  },
  getMailboxAccess: async (input) => {
    const { parseOrganizationApiMailboxId } =
      await import("../organization-api-mail");
    const organizationId = parseOrganizationApiMailboxId(input.mailboxId);
    if (organizationId !== null) {
      const { assertUserOrganizationMember } =
        await import("../mail-domain/service");
      await assertUserOrganizationMember({
        organizationId,
        userId: input.userId,
      });
      return {
        capabilities: getMailboxCapabilities({ provider: "api" }),
        organizationId,
      };
    }
    const { assertAccessibleMailbox } = await import("../mailbox/service");
    return await assertAccessibleMailbox(input);
  },
  getSession: async (headers) => {
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    const session = await getSessionWithOrganization(headers);
    return session?.user === undefined || session.session === undefined
      ? null
      : {
          expiresAt: session.session.expiresAt,
          sessionId: session.session.id,
          userId: session.user.id,
        };
  },
};

type ControlAdapterPolicy = {
  operations: readonly ControlOperationId[];
  scopes: readonly ControlScope[];
};

export type ControlAccess = {
  credential: { id: string; kind: "session" };
  operation: ControlOperation;
  target: ControlTarget;
  userId: string;
};

export const authenticateControlRequest = async (
  headers: Headers,
  services: Pick<
    ControlAuthorizationServices,
    "getSession"
  > = authorizationServices
): Promise<ControlSession> => {
  if (
    headers.has("authorization") ||
    headers.has("x-api-key") ||
    headers.has("api-key")
  ) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Use a signed-in session for management access.",
    });
  }
  const session = await services.getSession(headers);
  if (
    session === null ||
    session.userId === "" ||
    session.sessionId === "" ||
    !Number.isFinite(session.expiresAt.getTime()) ||
    session.expiresAt.getTime() <= Date.now()
  ) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Sign in again to continue.",
    });
  }
  return session;
};

const authorizeTarget = async (input: {
  operation: ControlOperation;
  services: ControlAuthorizationServices;
  target: ControlTarget;
  userId: string;
}): Promise<void> => {
  const { operation, services, target, userId } = input;
  if (operation.target !== target.kind) {
    throw new ORPCError("FORBIDDEN");
  }
  switch (target.kind) {
    case "mailbox": {
      const mailbox = await services.getMailboxAccess({
        mailboxId: target.mailboxId,
        userId,
      });
      if (
        mailbox.organizationId !== target.organizationId ||
        ("capability" in operation &&
          !mailbox.capabilities[operation.capability])
      ) {
        throw new ORPCError("NOT_FOUND");
      }
      break;
    }
    case "calendar": {
      await services.assertCalendarAccess({
        connectionId: target.connectionId,
        userId,
      });
      break;
    }
    case "organization": {
      await services.assertOrganizationAccess({
        manage: "organizationManager" in operation,
        organizationId: target.organizationId,
        userId,
      });
      break;
    }
    case "user": {
      break;
    }
    default: {
      const exhaustive: never = target;
      throw new ORPCError("FORBIDDEN", { cause: exhaustive });
    }
  }
};

export const createControlAuthorizer = (
  policy: ControlAdapterPolicy,
  services: ControlAuthorizationServices = authorizationServices
) => ({
  authorize: async (input: {
    headers: Headers;
    operation: ControlOperationId;
    target: ControlTarget;
  }): Promise<ControlAccess> => {
    const session = await authenticateControlRequest(input.headers, services);
    const operation = controlOperations.find(
      (candidate) => candidate.id === input.operation
    );
    if (
      operation === undefined ||
      !policy.operations.includes(operation.id) ||
      !policy.scopes.includes(operation.scope)
    ) {
      throw new ORPCError("FORBIDDEN");
    }
    const target = controlTargetSchema.parse(input.target);
    await authorizeTarget({
      operation,
      services,
      target,
      userId: session.userId,
    });
    return {
      credential: { id: session.sessionId, kind: "session" },
      operation,
      target,
      userId: session.userId,
    };
  },
  discover: async (input: {
    headers: Headers;
    target: ControlTarget;
  }): Promise<ControlOperation[]> => {
    const session = await authenticateControlRequest(input.headers, services);
    const target = controlTargetSchema.parse(input.target);
    const candidates = controlOperations.filter(
      (operation) =>
        operation.target === target.kind &&
        policy.operations.includes(operation.id) &&
        policy.scopes.includes(operation.scope)
    );
    const results = await Promise.all(
      candidates.map(async (operation) => {
        try {
          await authorizeTarget({
            operation,
            services,
            target,
            userId: session.userId,
          });
          return operation;
        } catch (error) {
          if (
            error instanceof ORPCError &&
            (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
          ) {
            return null;
          }
          throw error;
        }
      })
    );
    return results.filter((operation) => operation !== null);
  },
});
