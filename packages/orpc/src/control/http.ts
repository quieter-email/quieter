import { ORPCError } from "@orpc/server";

import type { ControlApplicationRuntime } from "./application-runtime";
import { controlDiscoveryInputSchema, controlErrorSchema } from "./contracts";
import {
  CONTROL_REVIEW_HEADER,
  CONTROL_REVIEW_INTENT,
  controlMutationActionSchema,
  controlMutationPrepareSchema,
} from "./mutation-contracts";
import {
  CONTROL_API_PATH,
  CONTROL_API_VERSION,
  CONTROL_API_VERSION_HEADER,
} from "./openapi";
import type { ControlReadRuntime, ControlRequestContext } from "./runtime";

const maxControlBodyBytes = 64 * 1024;
const mutationActions = new Map<string, "review" | "cancel" | "approve">([
  ["mutations/review", "review"],
  ["mutations/cancel", "cancel"],
  ["reviews/approve", "approve"],
]);
const publicFailures = {
  BAD_REQUEST: { message: "Invalid management request.", status: 400 },
  CANCELLED: { message: "The request was cancelled.", status: 499 },
  CONFLICT: {
    message: "The request conflicts with the current state. Try again.",
    status: 409,
  },
  FORBIDDEN: {
    message: "You do not have access to this operation.",
    status: 403,
  },
  NOT_FOUND: {
    message: "The requested resource is not available.",
    status: 404,
  },
  RATE_LIMITED: {
    message: "Too many requests. Try again shortly.",
    status: 429,
  },
  REAUTHENTICATION_REQUIRED: {
    message: "Reconnect the selected account to continue.",
    status: 401,
  },
  UNAUTHORIZED: {
    message: "Sign in or reconnect the selected account to continue.",
    status: 401,
  },
  UNSUPPORTED_OPERATION: {
    message: "This management operation is not available.",
    status: 404,
  },
} as const;

const readControlJson = async (request: Request): Promise<unknown> => {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new ORPCError("BAD_REQUEST", { status: 415 });
  }
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/u.test(declared) &&
    Number(declared) > maxControlBodyBytes
  ) {
    throw new ORPCError("BAD_REQUEST", { status: 413 });
  }
  if (request.body === null) {
    throw new ORPCError("BAD_REQUEST");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxControlBodyBytes) {
        await reader.cancel();
        throw new ORPCError("BAD_REQUEST", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    return body;
  } catch {
    throw new ORPCError("BAD_REQUEST");
  }
};

export const handleControlHttpRequest = async (
  request: Request,
  options: {
    reportError?: (error: Error) => void;
    runtime?: ControlReadRuntime | ControlApplicationRuntime;
    scheduleBackgroundTask?: (task: Promise<unknown>) => void;
  } = {}
): Promise<Response> => {
  const headers = new Headers({
    "cache-control": "private, no-store",
    [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION,
  });
  const context: ControlRequestContext = {
    headers: new Headers(request.headers),
    responseHeaders: headers,
    scheduleBackgroundTask: options.scheduleBackgroundTask,
    signal: request.signal,
  };
  try {
    request.signal.throwIfAborted();
    if (
      request.headers.get(CONTROL_API_VERSION_HEADER)?.trim() !==
      CONTROL_API_VERSION
    ) {
      throw new ORPCError("BAD_REQUEST");
    }
    const url = new URL(request.url);
    const { pathname } = url;
    let executor = options.runtime;
    if (executor === undefined) {
      const { createControlApplicationRuntime } =
        await import("./application-runtime");
      executor = createControlApplicationRuntime();
    }
    const relativePath = pathname.startsWith(`${CONTROL_API_PATH}/`)
      ? pathname.slice(CONTROL_API_PATH.length + 1)
      : "";
    const mutationAction = mutationActions.get(relativePath);
    const expectedMethod =
      pathname === `${CONTROL_API_PATH}/openapi` ? "GET" : "POST";
    if (request.method !== expectedMethod) {
      headers.set("allow", expectedMethod);
      return Response.json(
        controlErrorSchema.parse({
          error: {
            code: "BAD_REQUEST",
            message: "This request method is not supported.",
          },
        }),
        { headers, status: 405 }
      );
    }
    if (pathname === `${CONTROL_API_PATH}/openapi`) {
      return Response.json(await executor.openApi(context), { headers });
    }
    if (
      relativePath === "mutations/prepare" ||
      relativePath === "organization.settings.update" ||
      mutationAction !== undefined
    ) {
      const origin = request.headers.get("origin");
      if (origin !== null && origin !== url.origin) {
        throw new ORPCError("FORBIDDEN");
      }
      if (
        mutationAction === "approve" &&
        (origin !== url.origin ||
          request.headers.get("sec-fetch-site") !== "same-origin" ||
          request.headers.get(CONTROL_REVIEW_HEADER) !== CONTROL_REVIEW_INTENT)
      ) {
        throw new ORPCError("FORBIDDEN");
      }
    }
    const body = await readControlJson(request);
    if (relativePath === "mutations/prepare") {
      if (!("prepare" in executor)) {
        throw new ORPCError("UNSUPPORTED_OPERATION");
      }
      const parameters = controlMutationPrepareSchema.safeParse(body);
      if (!parameters.success) {
        throw new ORPCError("BAD_REQUEST");
      }
      return Response.json(
        await executor.prepare({ context, parameters: parameters.data }),
        { headers }
      );
    }
    if (mutationAction !== undefined) {
      if (!("review" in executor)) {
        throw new ORPCError("UNSUPPORTED_OPERATION");
      }
      const parameters = controlMutationActionSchema.safeParse(body);
      if (!parameters.success) {
        throw new ORPCError("BAD_REQUEST");
      }
      return Response.json(
        await executor[mutationAction]({ context, id: parameters.data.id }),
        { headers }
      );
    }
    if (pathname === `${CONTROL_API_PATH}/capabilities`) {
      const target = controlDiscoveryInputSchema.safeParse(body);
      if (!target.success) {
        throw new ORPCError("BAD_REQUEST");
      }
      return Response.json(
        await executor.discover({ context, target: target.data }),
        { headers }
      );
    }
    return Response.json(
      await executor.execute({
        context,
        operation: relativePath,
        parameters: body,
      }),
      { headers }
    );
  } catch (error) {
    if (request.signal.aborted) {
      return Response.json(
        {
          error: {
            code: "CANCELLED",
            message: publicFailures.CANCELLED.message,
          },
        },
        { headers, status: 499 }
      );
    }
    let publicCode: unknown =
      error instanceof ORPCError ? error.code : undefined;
    if (publicCode === "TOO_MANY_REQUESTS") {
      publicCode = "RATE_LIMITED";
    }
    if (publicCode === "MAILBOX_SCOPE_REPAIR_REQUIRED") {
      publicCode = "REAUTHENTICATION_REQUIRED";
    }
    const failure =
      error instanceof ORPCError
        ? Object.entries(publicFailures).find(([code]) => code === publicCode)
        : undefined;
    if (error instanceof ORPCError && failure !== undefined) {
      const [code, description] = failure;
      const status =
        error.status === 413 ||
        error.status === 415 ||
        error.code === "MAILBOX_SCOPE_REPAIR_REQUIRED"
          ? error.status
          : description.status;
      const retry = Number(headers.get("retry-after"));
      const retryAfterMs =
        headers.has("retry-after") && Number.isFinite(retry) && retry >= 0
          ? retry * 1000
          : undefined;
      return Response.json(
        controlErrorSchema.parse({
          error: {
            code,
            message:
              error.code === "MAILBOX_SCOPE_REPAIR_REQUIRED"
                ? "Open Quieter to restore access to the selected mailbox, then try again."
                : description.message,
            retryAfterMs,
          },
        }),
        { headers, status }
      );
    }
    options.reportError?.(new Error("Unexpected management request failure."));
    return Response.json(
      controlErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "The request failed. Try again shortly.",
        },
      }),
      { headers, status: 500 }
    );
  }
};
