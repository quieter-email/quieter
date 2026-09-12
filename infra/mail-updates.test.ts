/* oxlint-disable eslint/prefer-arrow-callback -- SST component mocks must be constructible. */
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

describe("mail update endpoint preparation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test.each(["refresh", "diff", "deploy"])(
    "resolves the first production endpoint during %s without resource outputs",
    async (command) => {
      vi.stubGlobal("$app", { stage: "production" });
      vi.stubGlobal("$cli", { command });
      const worker = vi.fn<(_name: string, args: unknown) => object>(
        function Worker() {
          return {
            get url() {
              throw new Error("A new Worker has no generated URL");
            },
          };
        }
      );
      vi.stubGlobal("sst", {
        Linkable: vi.fn<() => object>(function Linkable() {
          return {};
        }),
        Secret: vi.fn<() => object>(function Secret() {
          return {};
        }),
        cloudflare: {
          DurableObject: vi.fn<() => object>(function DurableObject() {
            return { className: "MailLiveUser" };
          }),
          Hyperdrive: { get: vi.fn<() => object>(() => ({})) },
          Worker: worker,
        },
      });
      const { createMailUpdateResources } = await import("./mail-updates");
      const resources = createMailUpdateResources(
        { SENTRY_DSN: new sst.Linkable("SENTRY_DSN", { properties: {} }) },
        { GMAIL_LIVE_SYNC_TOKEN_SECRET: new sst.Secret("Signing") },
        sst.cloudflare.Hyperdrive.get("Database", { hyperdriveId: "fixture" })
      );
      expect(resources.url).toBe("wss://updates.quieter.email/mail/live");
      expect(worker).toHaveBeenCalledWith(
        "MailUpdatesWorker",
        expect.objectContaining({ domain: "updates.quieter.email" })
      );
    }
  );
});
