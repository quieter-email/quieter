import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { handleDesktopRequest } from "../routes/api/desktop.$";
import { reportServerError } from "./server-error-reporting";

// oxlint-disable-next-line vitest/prefer-import-in-mock -- These test procedures isolate HTTP behavior from the real mailbox contracts.
vi.mock("@quieter/orpc/desktop-router", async () => {
  const { ORPCError, os } = await import("@orpc/server");
  return {
    desktopRouter: {
      mail: {
        failure: os.route({ method: "GET" }).handler(() => {
          throw new Error("Test failure");
        }),
        forbidden: os.route({ method: "GET" }).handler(() => {
          throw new ORPCError("FORBIDDEN");
        }),
        listMailboxes: os
          .route({ method: "GET" })
          .handler(() => [{ id: "mailbox-1" }]),
        unauthorized: os.route({ method: "GET" }).handler(() => {
          throw new ORPCError("UNAUTHORIZED");
        }),
      },
    },
  };
});

vi.mock(import("./server-error-reporting"), () => ({
  reportServerError: vi.fn<typeof reportServerError>(),
}));

describe("desktop API cache safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("serves mailbox responses without permitting storage", async () => {
    const response = await handleDesktopRequest(
      new Request("https://quieter.email/api/desktop/mail/listMailboxes")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toStrictEqual([{ id: "mailbox-1" }]);
    expect(reportServerError).not.toHaveBeenCalled();
  });

  test.each([
    ["unauthorized", 401],
    ["forbidden", 403],
  ])("does not cache or report expected %s responses", async (path, status) => {
    const response = await handleDesktopRequest(
      new Request(`https://quieter.email/api/desktop/mail/${path}`)
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(reportServerError).not.toHaveBeenCalled();
  });

  test("reports unexpected failures without caching their response", async () => {
    const response = await handleDesktopRequest(
      new Request("https://quieter.email/api/desktop/mail/failure")
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(reportServerError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Test failure" }),
      "desktop-api"
    );
  });

  test("does not cache unknown desktop routes", async () => {
    const response = await handleDesktopRequest(
      new Request("https://quieter.email/api/desktop/not-found")
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("Not Found");
    expect(reportServerError).not.toHaveBeenCalled();
  });
});
