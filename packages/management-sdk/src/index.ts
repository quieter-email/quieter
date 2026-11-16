import {
  controlContracts,
  controlDiscoveryInputSchema,
  controlDiscoveryOutputSchema,
  controlErrorSchema,
} from "@quieter/orpc/control/contracts";
import type {
  ControlRequest,
  ControlResult,
} from "@quieter/orpc/control/contracts";
import {
  CONTROL_API_PATH,
  CONTROL_API_VERSION,
  CONTROL_API_VERSION_HEADER,
} from "@quieter/orpc/control/openapi";
import { controlOperationIdSchema } from "@quieter/orpc/control/registry";
import type { ControlOperationId } from "@quieter/orpc/control/registry";
import type { z } from "zod";

export type ManagementOperationId = ControlOperationId;
export type ManagementRequest<Operation extends ManagementOperationId> =
  ControlRequest<Operation>;
export type ManagementResult<Operation extends ManagementOperationId> =
  ControlResult<Operation>;
export type ManagementTarget = z.input<typeof controlDiscoveryInputSchema>;
export type ManagementCapabilities = z.output<
  typeof controlDiscoveryOutputSchema
>;

type ParsedRequests = {
  [Operation in ManagementOperationId]: z.output<
    (typeof controlContracts)[Operation]["input"]
  >;
};

export const managementContracts: {
  [Operation in ManagementOperationId]: {
    input: z.ZodType<ParsedRequests[Operation], ManagementRequest<Operation>>;
    output: z.ZodType<ManagementResult<Operation>>;
  };
} = controlContracts;
export const managementOperationIdSchema = controlOperationIdSchema;
export const managementTargetSchema = controlDiscoveryInputSchema;

const errorMessages = {
  BAD_REQUEST: "Invalid management request.",
  CANCELLED: "The request was cancelled.",
  CONFLICT: "The request conflicts with the current state.",
  FORBIDDEN: "You do not have access to this operation.",
  INTERNAL_ERROR: "The request could not be completed.",
  INVALID_ORIGIN: "Provide a secure application origin.",
  INVALID_REQUEST: "Invalid management request parameters.",
  INVALID_RESPONSE: "The application returned an invalid management response.",
  NETWORK_ERROR: "The application could not be reached.",
  NOT_FOUND: "The requested resource is not available.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  REAUTHENTICATION_REQUIRED: "Reconnect the selected account to continue.",
  SESSION_UNAVAILABLE: "The application session is not available.",
  UNAUTHORIZED: "Sign in to continue.",
  UNSUPPORTED_OPERATION: "This management operation is not available.",
};

export type ManagementErrorCode = keyof typeof errorMessages;

export class ManagementError extends Error {
  readonly code: ManagementErrorCode;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  readonly status?: number;

  constructor(
    code: ManagementErrorCode,
    details: { requestId?: string; retryAfterMs?: number; status?: number } = {}
  ) {
    super(errorMessages[code]);
    this.name = "ManagementError";
    this.code = code;
    this.requestId = details.requestId;
    this.retryAfterMs = details.retryAfterMs;
    this.status = details.status;
  }
}

export const normalizeManagementOrigin = (origin: string): string => {
  try {
    const authority = /^https?:\/\/(?<authority>[^/?#\\]+)\/?$/iu.exec(origin)
      ?.groups?.authority;
    const url = new URL(origin);
    if (
      !authority ||
      authority.includes("@") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        (url.protocol !== "http:" ||
          !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu.test(authority)))
    ) {
      throw new ManagementError("INVALID_ORIGIN");
    }
    return url.origin;
  } catch {
    throw new ManagementError("INVALID_ORIGIN");
  }
};

export type ManagementAuth =
  | { kind: "browser-session" }
  | {
      kind: "session-cookie";
      getCookie: (input: {
        origin: string;
        signal?: AbortSignal;
      }) => string | Promise<string>;
    };

export type ManagementClient = {
  capabilities: (input: {
    target: ManagementTarget;
    signal?: AbortSignal;
  }) => Promise<ManagementCapabilities>;
  execute: <Operation extends ManagementOperationId>(input: {
    operation: Operation;
    parameters: ManagementRequest<NoInfer<Operation>>;
    signal?: AbortSignal;
  }) => Promise<ManagementResult<Operation>>;
};

export const createManagementClient = (options: {
  origin: string;
  auth: ManagementAuth;
  fetch?: typeof globalThis.fetch;
}): ManagementClient => {
  const origin = normalizeManagementOrigin(options.origin);
  const requestFetch = options.fetch ?? globalThis.fetch;

  const request = async (input: {
    path: string;
    parameters: unknown;
    signal?: AbortSignal;
  }): Promise<unknown> => {
    if (input.signal?.aborted ?? false) {
      throw new ManagementError("CANCELLED");
    }
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
      [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION,
    });
    if (options.auth.kind === "session-cookie") {
      try {
        const cookie = await options.auth.getCookie({
          origin,
          signal: input.signal,
        });
        if (
          typeof cookie !== "string" ||
          !cookie.trim() ||
          /[^\u0020-\u007E]/u.test(cookie)
        ) {
          throw new ManagementError("SESSION_UNAVAILABLE");
        }
        headers.set("cookie", cookie);
      } catch {
        throw new ManagementError(
          (input.signal?.aborted ?? false) ? "CANCELLED" : "SESSION_UNAVAILABLE"
        );
      }
    }
    if (input.signal?.aborted ?? false) {
      throw new ManagementError("CANCELLED");
    }
    let response: Response;
    try {
      response = await requestFetch(
        `${origin}${CONTROL_API_PATH}/${input.path}`,
        {
          body: JSON.stringify(input.parameters),
          credentials:
            options.auth.kind === "browser-session" ? "include" : "omit",
          headers,
          method: "POST",
          redirect: "error",
          signal: input.signal,
        }
      );
    } catch {
      throw new ManagementError(
        (input.signal?.aborted ?? false) ? "CANCELLED" : "NETWORK_ERROR"
      );
    }
    if (input.signal?.aborted ?? false) {
      throw new ManagementError("CANCELLED");
    }
    if (
      response.redirected ||
      response.headers.get(CONTROL_API_VERSION_HEADER) !==
        CONTROL_API_VERSION ||
      response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      throw new ManagementError("INVALID_RESPONSE", {
        status: response.status,
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ManagementError(
        (input.signal?.aborted ?? false) ? "CANCELLED" : "INVALID_RESPONSE",
        { status: response.status }
      );
    }
    if (input.signal?.aborted ?? false) {
      throw new ManagementError("CANCELLED");
    }
    if (!response.ok) {
      const error = controlErrorSchema.safeParse(body);
      if (!error.success) {
        throw new ManagementError("INVALID_RESPONSE", {
          status: response.status,
        });
      }
      throw new ManagementError(error.data.error.code, {
        requestId: error.data.error.requestId,
        retryAfterMs: error.data.error.retryAfterMs,
        status: response.status,
      });
    }
    return body;
  };

  return {
    async capabilities(input) {
      const target = managementTargetSchema.safeParse(input.target);
      if (!target.success) {
        throw new ManagementError("INVALID_REQUEST");
      }
      const result = controlDiscoveryOutputSchema.safeParse(
        await request({
          parameters: target.data,
          path: "capabilities",
          signal: input.signal,
        })
      );
      if (!result.success) {
        throw new ManagementError("INVALID_RESPONSE");
      }
      return result.data;
    },
    async execute<Operation extends ManagementOperationId>(input: {
      operation: Operation;
      parameters: ManagementRequest<NoInfer<Operation>>;
      signal?: AbortSignal;
    }): Promise<ManagementResult<Operation>> {
      const operation = managementOperationIdSchema.safeParse(input.operation);
      if (!operation.success) {
        throw new ManagementError("INVALID_REQUEST");
      }
      const contract = managementContracts[input.operation];
      const parameters = contract.input.safeParse(input.parameters);
      if (!parameters.success) {
        throw new ManagementError("INVALID_REQUEST");
      }
      const result = contract.output.safeParse(
        await request({
          parameters: parameters.data,
          path: operation.data,
          signal: input.signal,
        })
      );
      if (!result.success) {
        throw new ManagementError("INVALID_RESPONSE");
      }
      return result.data;
    },
  };
};
