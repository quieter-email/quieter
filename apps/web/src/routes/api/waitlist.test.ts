import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import "./waitlist";

const mocks = vi.hoisted(() => {
  const post: (input: { request: Request }) => Promise<Response> =
    vi.fn<(input: { request: Request }) => Promise<Response>>();
  return {
    post,
    recordWaitlistSignup:
      vi.fn<(email: string) => Promise<{ email: string; status: string }>>(),
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Capture route registration while exercising the real HTTP handler.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (options: {
      server: {
        handlers: { POST: (input: { request: Request }) => Promise<Response> };
      };
    }) => {
      mocks.post = options.server.handlers.POST;
      return options;
    },
}));
vi.mock(import("@quieter/orpc/waitlist"), () => ({
  recordWaitlistSignup: mocks.recordWaitlistSignup,
}));

describe("waitlist HTTP responses", () => {
  beforeEach(() => {
    mocks.recordWaitlistSignup.mockReset();
    mocks.recordWaitlistSignup.mockResolvedValue({
      email: "person@example.com",
      status: "accepted",
    });
  });

  test.each(["urlencoded", "multipart"])(
    "%s forms acknowledge uniformly in JSON and redirects",
    async (encoding) => {
      const email = "person@example.com";
      for (const accept of ["application/json", "text/html"]) {
        const responses = [];
        for (const attempt of [0, 1]) {
          const body =
            encoding === "urlencoded"
              ? new URLSearchParams({ email })
              : new FormData();
          body.set("email", email);
          const response = await mocks.post({
            request: new Request("https://example.test/api/waitlist", {
              body,
              headers: { accept },
              method: "POST",
            }),
          });
          responses[attempt] = {
            body: await response.text(),
            headers: [...response.headers],
            status: response.status,
          };
        }
        expect(responses[0]).toStrictEqual(responses[1]);
        expect(responses[0]?.status).toBe(
          accept === "application/json" ? 200 : 302
        );
      }
      expect(mocks.recordWaitlistSignup).toHaveBeenCalledWith(email);
    }
  );

  test("invalid addresses still fail validation without reaching persistence", async () => {
    const response = await mocks.post({
      request: new Request("https://example.test/api/waitlist", {
        body: new URLSearchParams({ email: "invalid" }),
        headers: { accept: "application/json" },
        method: "POST",
      }),
    });
    expect(response.status).toBe(400);
    expect(mocks.recordWaitlistSignup).not.toHaveBeenCalled();
  });
});
