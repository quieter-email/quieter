import { afterAll, describe, expect, test, vi } from "vite-plus/test";

vi.hoisted(() => {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
});

const { db, withRequestDatabaseClient } =
  await import("@quieter/database/client");
const { auth, organizationApiKeyApi } = await import("../src/index");
const { getSessionWithOrganization, handleSessionRequest } =
  await import("../src/session");

describe("auth in Worker request scopes", () => {
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  test("imports auth without opening an unscoped database client", () => {
    expect(organizationApiKeyApi.verifyApiKey).toBeTypeOf("function");
    expect(() => db.$client).toThrow(
      "Worker database access requires withRequestDatabaseClient."
    );
  });

  test("serves anonymous session requests without an outer database scope", async () => {
    const response = await handleSessionRequest(
      new Request("http://localhost:3000/api/auth/get-session")
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
    await expect(getSessionWithOrganization(new Headers())).resolves.toBeNull();
    expect(() => db.$client).toThrow(
      "Worker database access requires withRequestDatabaseClient."
    );
  });

  test("reuses auth across concurrent requests while keeping their clients separate", async () => {
    const clients = await Promise.all(
      [0, 1].map(
        async () =>
          await withRequestDatabaseClient(async (client) => {
            const response = await auth.handler(
              new Request("http://localhost:3000/api/auth/ok")
            );
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toStrictEqual({ ok: true });
            expect(db.$client).toBe(client.$client);
            await client.$client.end();
            return client;
          })
      )
    );
    expect(clients[0]).not.toBe(clients[1]);
    expect(() => db.$client).toThrow(
      "Worker database access requires withRequestDatabaseClient."
    );
  });
});
