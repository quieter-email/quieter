import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createR2ArchiveClient } from "../src/r2-archive-client.ts";

const input = {
  accountId: "a".repeat(32),
  bucket: "release-proof-test-archive",
  parentAccessKeyId: "b".repeat(32),
  readOnly: true,
  token: "private-bootstrap-token",
};

describe("temporary archive credentials", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([true, false])(
    "scopes access to the archive and refreshes expiring credentials, readOnly=%s",
    async (readOnly) => {
      vi.useFakeTimers();
      const response = Response.json({
        result: {
          accessKeyId: "temporary-access",
          secretAccessKey: "temporary-secret",
          sessionToken: "temporary-session",
        },
        success: true,
      });
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(response.clone());
      vi.stubGlobal("fetch", request);
      const client = createR2ArchiveClient({ ...input, readOnly });
      try {
        const first = await client.config.credentials();
        await expect(client.config.credentials()).resolves.toStrictEqual(first);
        expect(request).toHaveBeenCalledOnce();
        const [[url, init]] = request.mock.calls;
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected JSON credential scope.");
        }
        const scope: unknown = JSON.parse(init.body);
        expect({ url, ...init, body: scope }).toMatchObject({
          body: {
            bucket: input.bucket,
            parentAccessKeyId: input.parentAccessKeyId,
            permission: readOnly ? "object-read-only" : "object-read-write",
            prefixes: ["assets/", "receipts/"],
            ttlSeconds: 600,
          },
          headers: { authorization: `Bearer ${input.token}` },
          method: "POST",
          redirect: "error",
          url: `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/r2/temp-access-credentials`,
        });
        vi.setSystemTime(Date.now() + 601_000);
        const refreshed = await client.config.credentials();
        expect(request).toHaveBeenCalledTimes(2);
        expect(refreshed.expiration?.getTime()).toBeGreaterThan(
          first.expiration?.getTime() ?? 0
        );
      } finally {
        client.destroy();
      }
    }
  );

  it.each([
    { body: "private-provider-error", error: "HTTP 403", status: 403 },
    {
      body: "private-invalid-json",
      error: "Invalid temporary archive credential response.",
      status: 200,
    },
    {
      body: JSON.stringify({
        result: { secretAccessKey: "private-incomplete-secret" },
        success: true,
      }),
      error: "Invalid temporary archive credential response.",
      status: 200,
    },
  ])(
    "fails closed without exposing a provider response: $error",
    async ({ body, status, error }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }))
      );
      const client = createR2ArchiveClient(input);
      try {
        await expect(client.config.credentials()).rejects.toThrow(error);
      } finally {
        client.destroy();
      }
    }
  );
});
