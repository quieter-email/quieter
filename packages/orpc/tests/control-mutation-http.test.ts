import { ORPCError } from "@orpc/server";
import { describe, expect, test, vi } from "vite-plus/test";

import { createControlApplicationRuntime } from "../src/control/application-runtime";
import { authenticateControlRequest } from "../src/control/authority";
import type { ControlAuthorizationServices } from "../src/control/authority";
import { handleControlHttpRequest } from "../src/control/http";
import {
  CONTROL_REVIEW_HEADER,
  CONTROL_REVIEW_INTENT,
} from "../src/control/mutation-contracts";
import type { ControlMutationReview } from "../src/control/mutation-contracts";
import type { ControlMutationService } from "../src/control/mutations";
import {
  CONTROL_API_VERSION,
  CONTROL_API_VERSION_HEADER,
} from "../src/control/openapi";
import { createControlReadRuntime } from "../src/control/runtime";

const approvalId = "10a9cc5d-41ce-4f9a-93b1-425fc39e1ca2";
const origin = "https://app.example.test";
const prepareParameters = {
  idempotencyKey: "settings-change-a",
  openTrackingEnabled: false,
  organizationId: "team-a",
};
const prepared: ControlMutationReview = {
  createdAt: "2026-11-16T12:00:00.000Z",
  expiresAt: "2026-11-16T12:10:00.000Z",
  id: approvalId,
  operation: "organization.settings.update",
  organizationId: "team-a",
  organizationName: "Team A",
  patch: { openTrackingEnabled: false },
  reviewPath: `/control/review?approvalId=${approvalId}`,
  status: "prepared",
};

const createFixture = () => {
  const authorizationServices = {
    assertCalendarAccess: vi
      .fn<ControlAuthorizationServices["assertCalendarAccess"]>()
      .mockResolvedValue(),
    assertOrganizationAccess: vi
      .fn<ControlAuthorizationServices["assertOrganizationAccess"]>()
      .mockResolvedValue(),
    getMailboxAccess: vi
      .fn<ControlAuthorizationServices["getMailboxAccess"]>()
      .mockRejectedValue(new ORPCError("FORBIDDEN")),
    getSession: vi
      .fn<ControlAuthorizationServices["getSession"]>()
      .mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: "session-a",
        userId: "user-a",
      }),
  } satisfies ControlAuthorizationServices;
  const mutationService = {
    approve: vi.fn<ControlMutationService["approve"]>(async ({ context }) => {
      await authenticateControlRequest(context.headers, authorizationServices);
      return {
        ...prepared,
        approvedAt: "2026-11-16T12:01:00.000Z",
        status: "approved",
      };
    }),
    authorize: vi.fn<ControlMutationService["authorize"]>().mockResolvedValue(),
    cancel: vi.fn<ControlMutationService["cancel"]>().mockResolvedValue({
      ...prepared,
      approvedAt: null,
      completedAt: "2026-11-16T12:01:00.000Z",
      status: "cancelled",
    }),
    execute: vi.fn<ControlMutationService["execute"]>().mockResolvedValue({
      completedAt: "2026-11-16T12:01:00.000Z",
      createdAt: prepared.createdAt,
      operationId: approvalId,
      result: { allowPerSendOverride: false, openTrackingEnabled: false },
      state: "succeeded",
    }),
    prepare: vi
      .fn<ControlMutationService["prepare"]>()
      .mockResolvedValue(prepared),
    review: vi
      .fn<ControlMutationService["review"]>()
      .mockResolvedValue(prepared),
  } satisfies ControlMutationService;
  const runtime = createControlApplicationRuntime({
    authorizationServices,
    mutationService,
  });
  return { authorizationServices, mutationService, runtime };
};

const controlRequest = (
  path: string,
  options: { body?: unknown; headers?: HeadersInit; method?: string } = {}
) => {
  const method = options.method ?? "POST";
  return new Request(`${origin}/api/control/${path}`, {
    body:
      method === "GET"
        ? undefined
        : JSON.stringify(options.body ?? { id: approvalId }),
    headers: {
      "content-type": "application/json",
      cookie: "session=test",
      [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION,
      ...Object.fromEntries(new Headers(options.headers)),
    },
    method,
  });
};

const reviewHeaders = {
  origin,
  "sec-fetch-site": "same-origin",
  [CONTROL_REVIEW_HEADER]: CONTROL_REVIEW_INTENT,
};

describe("management mutation HTTP boundary", () => {
  test("routes preparation, review, cancellation and execution without approving or executing a review", async () => {
    const fixture = createFixture();
    const preparedResponse = await handleControlHttpRequest(
      controlRequest("mutations/prepare", { body: prepareParameters }),
      fixture
    );
    expect(preparedResponse.status).toBe(200);
    await expect(preparedResponse.json()).resolves.toMatchObject({
      patch: { openTrackingEnabled: false },
      status: "prepared",
    });
    const reviewRequest = controlRequest("mutations/review");
    const reviewed = await handleControlHttpRequest(reviewRequest, fixture);
    expect(reviewed.status).toBe(200);
    const reviewInput = fixture.mutationService.review.mock.calls[0]?.[0];
    expect(reviewInput?.context.signal).toBe(reviewRequest.signal);
    expect(reviewInput?.id).toBe(approvalId);
    expect(fixture.mutationService.approve).not.toHaveBeenCalled();
    expect(fixture.mutationService.execute).not.toHaveBeenCalled();
    const cancelled = await handleControlHttpRequest(
      controlRequest("mutations/cancel"),
      fixture
    );
    expect(cancelled.status).toBe(200);
    const executed = await handleControlHttpRequest(
      controlRequest("organization.settings.update", {
        body: { ...prepareParameters, approvalId },
      }),
      fixture
    );
    expect(executed.status).toBe(200);
    expect(
      fixture.mutationService.execute.mock.calls[0]?.[0].parameters
    ).toMatchObject({
      ...prepareParameters,
      approvalId,
    });
  });

  test("requires the same origin, browser metadata and review intent before approval", async () => {
    const fixture = createFixture();
    for (const headers of [
      {},
      { ...reviewHeaders, origin: "https://other.example.test" },
      { ...reviewHeaders, origin: "null" },
      { ...reviewHeaders, "sec-fetch-site": "" },
      { ...reviewHeaders, "sec-fetch-site": "cross-site" },
      { ...reviewHeaders, [CONTROL_REVIEW_HEADER]: "true" },
    ]) {
      const denied = await handleControlHttpRequest(
        controlRequest("reviews/approve", { headers }),
        fixture
      );
      expect(denied.status).toBe(403);
      expect(denied.headers.has("access-control-allow-origin")).toBeFalsy();
    }
    expect(fixture.mutationService.approve).not.toHaveBeenCalled();
  });

  test("accepts strict JSON approval from the signed-in browser without executing the settings setter", async () => {
    const fixture = createFixture();
    const request = controlRequest("reviews/approve", {
      headers: reviewHeaders,
    });
    const response = await handleControlHttpRequest(request, fixture);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/private.*no-store/u);
    await expect(response.json()).resolves.toMatchObject({
      status: "approved",
    });
    const approvalInput = fixture.mutationService.approve.mock.calls[0]?.[0];
    expect(approvalInput?.context.signal).toBe(request.signal);
    expect(approvalInput?.id).toBe(approvalId);
    expect(approvalInput?.context.headers.get("cookie")).toBe("session=test");
    expect(fixture.mutationService.execute).not.toHaveBeenCalled();
    fixture.authorizationServices.getSession.mockResolvedValueOnce(null);
    const missingSession = await handleControlHttpRequest(
      controlRequest("reviews/approve", {
        headers: { ...reviewHeaders, cookie: "" },
      }),
      fixture
    );
    expect(missingSession.status).toBe(401);
    const bearer = await handleControlHttpRequest(
      controlRequest("reviews/approve", {
        headers: { ...reviewHeaders, authorization: "Bearer not-a-session" },
      }),
      fixture
    );
    expect(bearer.status).toBe(401);
  });

  test("rejects confirmation shortcuts, non-JSON bodies and malformed IDs", async () => {
    const fixture = createFixture();
    for (const path of [
      "mutations/review",
      "mutations/cancel",
      "reviews/approve",
    ]) {
      for (const body of [
        {},
        { confirmed: true, id: approvalId },
        { actorUserId: "another-user", id: approvalId },
      ]) {
        const invalid = await handleControlHttpRequest(
          controlRequest(path, { body, headers: reviewHeaders }),
          fixture
        );
        expect(invalid.status).toBe(400);
      }
    }
    const nonJson = await handleControlHttpRequest(
      controlRequest("reviews/approve", {
        headers: { ...reviewHeaders, "content-type": "text/plain" },
      }),
      fixture
    );
    expect(nonJson.status).toBe(415);
    const invalidId = await handleControlHttpRequest(
      controlRequest("reviews/approve", {
        body: { id: "not-an-id" },
        headers: reviewHeaders,
      }),
      fixture
    );
    expect(invalidId.status).toBe(400);
    const injectedActor = await handleControlHttpRequest(
      controlRequest("mutations/prepare", {
        body: { ...prepareParameters, actorUserId: "another-user" },
      }),
      fixture
    );
    expect(injectedActor.status).toBe(400);
    expect(fixture.mutationService.approve).not.toHaveBeenCalled();
    expect(fixture.mutationService.prepare).not.toHaveBeenCalled();
    expect(fixture.mutationService.review).not.toHaveBeenCalled();
    expect(fixture.mutationService.cancel).not.toHaveBeenCalled();
  });

  test("rejects cross-origin preparation, execution and cancellation and enforces route methods", async () => {
    const fixture = createFixture();
    for (const path of [
      "mutations/prepare",
      "organization.settings.update",
      "mutations/cancel",
    ]) {
      const denied = await handleControlHttpRequest(
        controlRequest(path, {
          body: { ...prepareParameters, approvalId },
          headers: { origin: "https://other.example.test" },
        }),
        fixture
      );
      expect(denied.status).toBe(403);
    }
    const reviewGet = await handleControlHttpRequest(
      controlRequest("mutations/review", { method: "GET" }),
      fixture
    );
    expect(reviewGet.status).toBe(405);
    expect(reviewGet.headers.get("allow")).toBe("POST");
    const approveGet = await handleControlHttpRequest(
      controlRequest("reviews/approve", { method: "GET" }),
      fixture
    );
    expect(approveGet.status).toBe(405);
    expect(approveGet.headers.get("allow")).toBe("POST");
    expect(fixture.mutationService.prepare).not.toHaveBeenCalled();
    expect(fixture.mutationService.execute).not.toHaveBeenCalled();
    expect(fixture.mutationService.cancel).not.toHaveBeenCalled();
  });

  test("keeps injected read-only runtimes read-only", async () => {
    const fixture = createFixture();
    const readOnly = createControlReadRuntime(fixture);
    for (const [path, method] of [
      ["mutations/prepare", "POST"],
      ["mutations/review", "POST"],
      ["mutations/cancel", "POST"],
      ["reviews/approve", "POST"],
      ["organization.settings.update", "POST"],
    ]) {
      const response = await handleControlHttpRequest(
        controlRequest(path, {
          body: prepareParameters,
          headers: reviewHeaders,
          method,
        }),
        { runtime: readOnly }
      );
      expect(response.status).toBe(404);
    }
    expect(fixture.mutationService.prepare).not.toHaveBeenCalled();
    expect(fixture.mutationService.approve).not.toHaveBeenCalled();
  });

  test("sanitizes unexpected approval failures and reports only a fixed error", async () => {
    const fixture = createFixture();
    fixture.mutationService.approve.mockRejectedValue(
      new Error("private SQL and request contents")
    );
    const reportError = vi.fn<(error: Error) => void>();
    const response = await handleControlHttpRequest(
      controlRequest("reviews/approve", {
        headers: reviewHeaders,
      }),
      { ...fixture, reportError }
    );
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain("private SQL");
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError.mock.calls[0]?.[0].message).not.toContain("private SQL");
  });
});

describe("application runtime mutation capability", () => {
  test("discovers only the implemented organization write through the mutation authority check", async () => {
    const fixture = createFixture();
    const response = await fixture.runtime.discover({
      context: { headers: new Headers({ cookie: "session=test" }) },
      target: { kind: "organization", organizationId: "team-a" },
    });
    expect(response.operations).toMatchObject([
      { id: "organization.settings.update", scope: "organization:write" },
    ]);
    expect(response.operations).toHaveLength(1);
    expect(fixture.mutationService.authorize).toHaveBeenCalledOnce();
    expect(
      fixture.authorizationServices.assertOrganizationAccess
    ).not.toHaveBeenCalled();
    fixture.mutationService.authorize.mockRejectedValue(
      new ORPCError("FORBIDDEN")
    );
    await expect(
      fixture.runtime.discover({
        context: { headers: new Headers() },
        target: { kind: "organization", organizationId: "team-a" },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("narrows every mutation action by both operation and scope even with an injected mutation service", async () => {
    for (const policy of [
      { operations: [], scopes: ["organization:write"] },
      { operations: ["organization.settings.update"], scopes: [] },
    ] as const) {
      const fixture = createFixture();
      const runtime = createControlApplicationRuntime({ ...fixture, policy });
      const context = { headers: new Headers({ cookie: "session=test" }) };
      for (const call of [
        async () =>
          await runtime.prepare({ context, parameters: prepareParameters }),
        async () => await runtime.review({ context, id: approvalId }),
        async () => await runtime.approve({ context, id: approvalId }),
        async () => await runtime.cancel({ context, id: approvalId }),
        async () =>
          await runtime.execute({
            context,
            operation: "organization.settings.update",
            parameters: { ...prepareParameters, approvalId },
          }),
      ]) {
        await expect(call()).rejects.toMatchObject({
          code: "UNSUPPORTED_OPERATION",
        });
      }
      const discovery = await runtime.discover({
        context,
        target: { kind: "organization", organizationId: "team-a" },
      });
      expect(discovery.operations).toHaveLength(0);
      expect(fixture.mutationService.prepare).not.toHaveBeenCalled();
      expect(fixture.mutationService.review).not.toHaveBeenCalled();
      expect(fixture.mutationService.approve).not.toHaveBeenCalled();
      expect(fixture.mutationService.cancel).not.toHaveBeenCalled();
      expect(fixture.mutationService.execute).not.toHaveBeenCalled();
      fixture.authorizationServices.getSession.mockResolvedValue(null);
      await expect(
        runtime.prepare({ context, parameters: prepareParameters })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  test("documents implemented lifecycle operations without publishing the human approval endpoint", async () => {
    const fixture = createFixture();
    const context = { headers: new Headers({ cookie: "session=test" }) };
    const document = await fixture.runtime.openApi(context);
    const paths = Object.keys(document.paths);
    expect(paths).toContain("/api/control/organization.settings.update");
    expect(paths).toContain("/api/control/mutations/prepare");
    expect(paths).toContain("/api/control/mutations/review");
    expect(paths).toContain("/api/control/mutations/cancel");
    expect(paths.some((path) => path.includes("approve"))).toBeFalsy();
    expect(paths).not.toContain("/api/control/settings.read");
    expect(paths).not.toContain("/api/control/automation.read");
    expect(paths).not.toContain("/api/control/mail.set_read");
    const narrowed = createControlApplicationRuntime({
      ...fixture,
      policy: { operations: ["calendar.accounts"], scopes: ["calendar:read"] },
    });
    const narrowedDocument = await narrowed.openApi(context);
    expect(Object.keys(narrowedDocument.paths)).toContain(
      "/api/control/calendar.accounts"
    );
    expect(
      Object.keys(narrowedDocument.paths).some(
        (path) => path.includes("mutations") || path.includes("settings.update")
      )
    ).toBeFalsy();
  });
});
