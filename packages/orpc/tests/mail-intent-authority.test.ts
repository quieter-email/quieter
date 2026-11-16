import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { captureAiOrigin } from "../src/ai-authority";
import type { getMailboxMemoryActor } from "../src/ai-memory-capture";
import {
  captureMailSendIntentAuthority,
  readMailSendIntentAuthority,
} from "../src/mail/intent-authority";

const fixture = vi.hoisted(() => ({
  actor: vi.fn<typeof getMailboxMemoryActor>(),
  capture: vi.fn<typeof captureAiOrigin>(),
}));
vi.mock(import("../src/ai-authority"), async (importOriginal) => ({
  ...(await importOriginal()),
  captureAiOrigin: fixture.capture,
}));
vi.mock(import("../src/ai-memory-capture"), () => ({
  getMailboxMemoryActor: fixture.actor,
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<() => void>(),
}));

const binding = { mailboxId: "inbox", userId: "owner" };
const origin = {
  kind: "ai",
  mailboxId: binding.mailboxId,
  mode: "interactive",
  policyVersion: 3,
  userId: binding.userId,
} as const;

describe("mail send intent authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fixture.actor.mockResolvedValue({ userId: binding.userId });
    fixture.capture.mockResolvedValue({
      ...origin,
      mode: "automation",
      policyVersion: 9,
    });
  });

  test("keeps the initiating AI policy epoch for separate learning on accepted recovery", async () => {
    const authority = await captureMailSendIntentAuthority({
      ...binding,
      origin,
    });
    const stored: unknown = structuredClone(authority);
    expect(readMailSendIntentAuthority(stored, binding)).toMatchObject({
      learning: { ...origin, mode: "automation" },
      operation: origin,
    });
  });

  test("keeps human sending available when optional private learning is unavailable", async () => {
    fixture.actor.mockRejectedValue(new Error("Memory lookup unavailable"));
    await expect(
      captureMailSendIntentAuthority({
        ...binding,
        origin: { kind: "human" },
      })
    ).resolves.toMatchObject({ learning: null, operation: { kind: "human" } });
    fixture.actor.mockResolvedValue({ userId: "billing-owner" });
    await expect(
      captureMailSendIntentAuthority({
        ...binding,
        origin: { kind: "human" },
      })
    ).resolves.toMatchObject({ learning: null, operation: { kind: "human" } });
  });

  test("does not invent authority for legacy, foreign or altered accepted intent packets", () => {
    const authority = {
      learning: { ...origin, mode: "automation" },
      operation: origin,
    };
    const invalid: unknown[] = [
      undefined,
      null,
      { operation: origin },
      { ...authority, policyVersion: 3 },
      { ...authority, operation: { kind: "system" } },
      { ...authority, operation: { ...origin, userId: "other" } },
      { ...authority, operation: { ...origin, mailboxId: "other" } },
      { ...authority, learning: { ...origin, mode: "interactive" } },
      {
        ...authority,
        learning: { ...origin, mode: "automation", policyVersion: 9 },
      },
      {
        ...authority,
        learning: { ...origin, mode: "automation", userId: "other" },
      },
    ];
    for (const value of invalid) {
      expect(readMailSendIntentAuthority(value, binding)).toBeNull();
    }
    expect(
      readMailSendIntentAuthority(
        { learning: null, operation: origin },
        binding
      )
    ).toMatchObject({ learning: null, operation: origin });
  });
});
