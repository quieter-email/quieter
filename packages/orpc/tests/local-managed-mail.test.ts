import { describe, expect, it, vi } from "vite-plus/test";

import {
  assertLocalMailDomain,
  assertLocalMailSend,
} from "../src/local-managed-mail";

const environment = vi.hoisted(() => ({ local: true }));
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      get QUIETER_DEPLOYMENT_ENV() {
        return environment.local ? "local" : "production";
      },
    },
  };
});
describe("managed-mail provider isolation", () => {
  it("blocks real domain changes and external delivery in local development", () => {
    environment.local = true;
    expect(assertLocalMailDomain).toThrow("deployed environment");
    expect(assertLocalMailSend).toThrow("deployed environment");
  });

  it("leaves deployed mail operations to their normal authorization checks", () => {
    environment.local = false;
    expect(assertLocalMailDomain).not.toThrow();
    expect(assertLocalMailSend).not.toThrow();
  });
});
