import { setImmediate } from "node:timers/promises";

import { ORPCError } from "@orpc/server";
import type { listMessagesForAgent } from "@quieter/gmail";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { configureErrorReporter } from "@quieter/observability";
import type { ErrorReporter } from "@quieter/observability";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { loadMailAutoLabelHistory } from "../src/mail-automation/history";

const fixtures = vi.hoisted(() => ({
  list: vi.fn<typeof listMessagesForAgent>(),
  reported: vi.fn<ErrorReporter>(),
}));

vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  listMessagesForAgent: fixtures.list,
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: async (request) =>
    await Promise.resolve({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 1,
      id: request.mailboxId,
      organizationId: "fixture-team",
      provider: "gmail" as const,
    }),
}));

const input = {
  accessToken: "fixture-token",
  labels: [{ id: "work", name: "Work" }],
  mailboxId: "fixture-mailbox",
  message: { from: "sender@example.test", id: "target-message" },
  provider: "gmail" as const,
  userId: "fixture-user",
};
type HistoryPage = Awaited<ReturnType<typeof listMessagesForAgent>>;

describe("automatic label history failures", () => {
  beforeEach(() => {
    fixtures.list.mockReset();
    fixtures.reported.mockReset();
    configureErrorReporter(fixtures.reported);
  });

  test("keeps unexpected optional failures visible without leaking request context", async () => {
    fixtures.list.mockRejectedValue(
      new Error("Transport failed for fixture-token.")
    );
    await expect(loadMailAutoLabelHistory(input)).resolves.toBeNull();
    expect(fixtures.reported).toHaveBeenCalledOnce();
    const [report] = fixtures.reported.mock.calls;
    expect(String(report?.[0])).not.toContain("fixture-token");
    expect(JSON.stringify(report?.[1])).not.toContain(input.mailboxId);
  });

  test("overlaps complete lanes while keeping pagination serial within each lane", async () => {
    const pages = {
      domain: [
        Promise.withResolvers<HistoryPage>(),
        Promise.withResolvers<HistoryPage>(),
      ],
      sender: [
        Promise.withResolvers<HistoryPage>(),
        Promise.withResolvers<HistoryPage>(),
      ],
    };
    const active = { domain: 0, sender: 0 };
    const maximum = { domain: 0, sender: 0 };
    const finished = { domain: 0, sender: 0 };
    fixtures.list.mockImplementation(async (_token, request) => {
      const lane =
        request?.query?.includes("-from:") === true ? "domain" : "sender";
      active[lane] += 1;
      maximum[lane] = Math.max(maximum[lane], active[lane]);
      try {
        const page = pages[lane][request?.pageToken === undefined ? 0 : 1];
        if (page === undefined) {
          throw new Error("Fixture history page is missing.");
        }
        return await page.promise;
      } finally {
        active[lane] -= 1;
        finished[lane] += 1;
      }
    });
    const pending = loadMailAutoLabelHistory(input);
    try {
      await setImmediate();
      expect(active).toMatchObject({ domain: 1, sender: 1 });
      pages.sender[0]?.resolve({
        messages: [],
        nextPageToken: "sender-next",
      });
      await setImmediate();
      expect(finished).toMatchObject({ domain: 0, sender: 1 });
      expect(active).toMatchObject({ domain: 1, sender: 1 });
      pages.domain[0]?.resolve({
        messages: [],
        nextPageToken: "domain-next",
      });
      await setImmediate();
      expect(finished).toMatchObject({ domain: 1, sender: 1 });
      expect(active).toMatchObject({ domain: 1, sender: 1 });
    } finally {
      for (const page of [...pages.sender, ...pages.domain]) {
        page.resolve({ messages: [] });
      }
      await pending;
    }
    await expect(pending).resolves.toBeNull();
    expect(maximum).toMatchObject({ domain: 1, sender: 1 });
    expect(active).toMatchObject({ domain: 0, sender: 0 });
    expect(finished).toMatchObject({ domain: 2, sender: 2 });
  });

  test.each(["throttle", "authorization", "optional"])(
    "drains the other lane before returning a %s failure",
    async (kind) => {
      const sibling = Promise.withResolvers<HistoryPage>();
      const failure =
        kind === "authorization"
          ? new ORPCError("FORBIDDEN")
          : Object.assign(new Error("Private provider payload."), {
              status: kind === "throttle" ? 429 : 502,
            });
      fixtures.list.mockImplementation(async (_token, request) => {
        if (request?.query?.includes("-from:") === true) {
          return await sibling.promise;
        }
        throw failure;
      });
      let settled = false;
      const pending = (async () => {
        try {
          return await loadMailAutoLabelHistory(input);
        } catch (error) {
          return error;
        } finally {
          settled = true;
        }
      })();
      try {
        await setImmediate();
        expect(settled).toBeFalsy();
      } finally {
        sibling.resolve({ messages: [] });
        await pending;
      }
      await expect(pending).resolves.toBe(kind === "optional" ? null : failure);
    }
  );

  test.each([
    { first: "sender", longer: "sender" },
    { first: "domain", longer: "sender" },
    { first: "sender", longer: "domain" },
    { first: "domain", longer: "domain" },
  ])(
    "selects the longer $longer cooldown after $first rejects first",
    async ({ first, longer }) => {
      const lanes = {
        domain: Promise.withResolvers<HistoryPage>(),
        sender: Promise.withResolvers<HistoryPage>(),
      };
      const errors = {
        domain: Object.assign(new Error("Domain throttle."), {
          retryAfterMs: longer === "domain" ? 240_000 : 120_000,
          status: 429,
        }),
        sender: Object.assign(new Error("Sender throttle."), {
          retryAfterMs: longer === "sender" ? 240_000 : 120_000,
          status: 429,
        }),
      };
      fixtures.list.mockImplementation(
        async (_token, request) =>
          await lanes[
            request?.query?.includes("-from:") === true ? "domain" : "sender"
          ].promise
      );
      const pending = (async () => {
        try {
          return await loadMailAutoLabelHistory(input);
        } catch (error) {
          return error;
        }
      })();
      await setImmediate();
      lanes[first === "sender" ? "sender" : "domain"].reject(
        errors[first === "sender" ? "sender" : "domain"]
      );
      await setImmediate();
      const other = first === "sender" ? "domain" : "sender";
      lanes[other].reject(errors[other]);
      await expect(pending).resolves.toBe(
        errors[longer === "sender" ? "sender" : "domain"]
      );
      expect(fixtures.reported).not.toHaveBeenCalled();
    }
  );

  test.each([
    { domainDelay: 1000, selected: "sender", senderDelay: undefined },
    { domainDelay: undefined, selected: "domain", senderDelay: 1000 },
    { domainDelay: undefined, selected: "sender", senderDelay: undefined },
  ])(
    "uses effective cooldowns and stable precedence for $selected",
    async ({ domainDelay, selected, senderDelay }) => {
      const errors = {
        domain: Object.assign(new Error("Domain throttle."), {
          retryAfterMs: domainDelay,
          status: 429,
        }),
        sender: Object.assign(new Error("Sender throttle."), {
          retryAfterMs: senderDelay,
          status: 429,
        }),
      };
      fixtures.list.mockImplementation(
        async (_token, request) =>
          await Promise.reject(
            errors[
              request?.query?.includes("-from:") === true ? "domain" : "sender"
            ]
          )
      );
      await expect(loadMailAutoLabelHistory(input)).rejects.toBe(
        errors[selected === "sender" ? "sender" : "domain"]
      );
    }
  );

  test("propagates a domain throttle and reports a hidden optional sender failure once", async () => {
    const throttle = Object.assign(new Error("Private domain payload."), {
      status: 429,
    });
    fixtures.list.mockImplementation(
      async (_token, request) =>
        await Promise.reject(
          request?.query?.includes("-from:") === true
            ? throttle
            : new Error(`Private sender payload for ${input.accessToken}.`)
        )
    );
    await expect(loadMailAutoLabelHistory(input)).rejects.toBe(throttle);
    expect(fixtures.reported).toHaveBeenCalledOnce();
    const [report] = fixtures.reported.mock.calls;
    expect(String(report?.[0])).not.toContain("Private");
    expect(JSON.stringify(report)).not.toContain(input.accessToken);
    expect(JSON.stringify(report)).not.toContain(input.mailboxId);
  });
});
