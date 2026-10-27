import type * as DatabaseClientModule from "@quieter/database/client";
import { describe, expect, test, vi } from "vite-plus/test";

import { loadManagedAutomationMessage } from "../src/managed-mail/automation";

const mocks = vi.hoisted(() => ({
  select: vi.fn<(...args: unknown[]) => unknown>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  return { ...actual, db: { select: mocks.select } };
});

describe("managed automation OTP metadata", () => {
  test.each([false, true])(
    "normalizes stored top-level headers, duplicate=%s",
    async (duplicate) => {
      const header = {
        name: "OTP-Token",
        value: '"12 34"; origin="https://example.com"; bearer="private"',
      };
      mocks.select
        .mockReset()
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: async () => {
                await Promise.resolve();
                return [
                  {
                    createdAt: new Date(),
                    direction: "inbound",
                    headers: duplicate ? [header, header] : [header],
                    id: "message-1",
                    isRead: false,
                    mailboxState: "active",
                    threadId: "thread-1",
                  },
                ];
              },
            }),
          }),
        })
        .mockReturnValueOnce({
          from: () => ({
            where: async () => {
              await Promise.resolve();
              return [];
            },
          }),
        });
      const message = await loadManagedAutomationMessage(
        "mailbox-1",
        "message-1"
      );
      expect(message?.otpToken).toStrictEqual(
        duplicate ? undefined : { code: "12 34", origin: "https://example.com" }
      );
    }
  );
});
