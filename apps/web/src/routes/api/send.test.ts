import {
  API_COMPATIBILITY_DATE,
  API_VERSION_HEADER,
} from "@quieter/mail/public-api";
import type { sendOrganizationMailMessage } from "@quieter/orpc/organization-mail";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { reportServerError } from "#/lib/server-error-reporting";

import { Route } from "./send";

const mocks = vi.hoisted(() => ({
  send: vi.fn<typeof sendOrganizationMailMessage>(),
  authenticate: vi.fn<(request: Request) => Promise<string | null>>(),
}));
vi.mock(import("#/lib/organization-api-auth.server"), () => ({
  getOrganizationApiKeyOrganizationId: mocks.authenticate,
}));
vi.mock(import("#/lib/server-error-reporting"), () => ({
  reportServerError: vi.fn<typeof reportServerError>(),
}));
vi.mock(import("@quieter/orpc/organization-mail"), async (original) => ({
  ...(await original()),
  sendOrganizationMailMessage: mocks.send,
}));

const post = async (from: string, compatible = true) => {
  const handlers = Route.options.server?.handlers;
  if (
    handlers === undefined ||
    typeof handlers === "function" ||
    typeof handlers.POST !== "function"
  ) {
    throw new Error("The send route has no POST handler.");
  }
  const response = await handlers.POST({
    context: undefined,
    params: {},
    pathname: "/api/send",
    next: () => {
      throw new Error("Unexpected next handler.");
    },
    request: new Request("https://quieter.email/api/send", {
      method: "POST",
      body: JSON.stringify({
        from,
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      }),
      headers: compatible
        ? {
            [API_VERSION_HEADER]: API_COMPATIBILITY_DATE,
            "content-type": "application/json",
          }
        : {},
    }),
  });
  if (!(response instanceof Response)) {
    throw new Error("The send route did not return a response.");
  }
  return response;
};

describe("transactional send REST sender boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue("team-a");
    mocks.send.mockResolvedValue({ messageId: "synthetic", sent: true });
  });

  test.each([
    "victim@victim.example ( <sender@attacker.example>",
    "one@example.com, Two <two@example.com>",
    "Team: sender@example.com;",
  ])("rejects ambiguous From before dispatch %s", async (from) => {
    const response = await post(from);
    expect(response.status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("keeps the version contract and legitimate display sender", async () => {
    const rejected = await post("Demo <sender@example.com>", false);
    expect(rejected.status).toBe(400);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    const accepted = await post("Demo <sender@example.com>");
    expect(accepted.status).toBe(201);
    expect(accepted.headers.get(API_VERSION_HEADER)).toBe(
      API_COMPATIBILITY_DATE
    );
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "team-a" })
    );
  });
});
