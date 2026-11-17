import { describe, expect, test } from "vite-plus/test";

import {
  aiAuthorityInputs,
  aiOperationOriginSchema,
  getAiAuthorityDecision,
  mailboxAutomationOriginSchema,
} from "../src/ai-authority";
import type { AiOrigin } from "../src/ai-authority";

const interactive: AiOrigin = {
  kind: "ai",
  mailboxId: "private-inbox",
  mode: "interactive",
  policyVersion: 3,
  userId: "owner",
};

describe("mailbox assistant authority", () => {
  test.each(["interactive", "automation"] as const)(
    "read-only blocks %s domain writes while retaining read access",
    (mode) => {
      const origin = { ...interactive, mode };
      const policy = {
        automationPaused: false,
        readOnly: true,
        version: interactive.policyVersion,
      };
      expect(
        getAiAuthorityDecision({ effect: "write", origin, policy }).allowed
      ).toBeFalsy();
      expect(
        getAiAuthorityDecision({ effect: "read", origin, policy }).allowed
      ).toBeTruthy();
    }
  );

  test("automation pause fences automatic execution while permitting a fresh foreground request", () => {
    const policy = {
      automationPaused: true,
      readOnly: false,
      version: interactive.policyVersion,
    };
    expect(
      getAiAuthorityDecision({
        effect: "execute",
        origin: { ...interactive, mode: "automation" },
        policy,
      }).allowed
    ).toBeFalsy();
    expect(
      getAiAuthorityDecision({
        effect: "write",
        origin: interactive,
        policy,
      }).allowed
    ).toBeTruthy();
  });

  test("a pause followed by resume cannot restore an earlier AI request", () => {
    const resumedPolicy = {
      automationPaused: false,
      readOnly: false,
      version: interactive.policyVersion + 2,
    };
    expect(
      getAiAuthorityDecision({
        effect: "write",
        origin: interactive,
        policy: resumedPolicy,
      }).allowed
    ).toBeFalsy();
    expect(
      getAiAuthorityDecision({
        effect: "write",
        origin: { ...interactive, policyVersion: resumedPolicy.version },
        policy: resumedPolicy,
      }).allowed
    ).toBeTruthy();
  });

  test("both policies leave authenticated human commands available", () => {
    expect(
      getAiAuthorityDecision({
        effect: "write",
        origin: { kind: "human" },
        policy: { automationPaused: true, readOnly: true, version: 10 },
      }).allowed
    ).toBeTruthy();
  });

  test("built-in mailbox automation cannot become a user operation", () => {
    const origin = mailboxAutomationOriginSchema.parse({
      kind: "ai",
      mailboxId: interactive.mailboxId,
      mode: "automation",
      policyVersion: interactive.policyVersion,
      scope: "mailbox-automation",
    });
    expect(aiOperationOriginSchema.safeParse(origin).success).toBeFalsy();
    expect(
      getAiAuthorityDecision({
        effect: "write",
        origin,
        policy: {
          automationPaused: true,
          readOnly: false,
          version: origin.policyVersion,
        },
      }).allowed
    ).toBeFalsy();
  });

  test("public policy inputs reject actor and origin injection", () => {
    expect(
      aiAuthorityInputs.get.safeParse({
        mailboxId: interactive.mailboxId,
        userId: "another-user",
      }).success
    ).toBeFalsy();
    expect(
      aiAuthorityInputs.update.safeParse({
        automationPaused: false,
        expectedVersion: 0,
        mailboxId: interactive.mailboxId,
        origin: { kind: "human" },
        readOnly: false,
      }).success
    ).toBeFalsy();
  });

  test.each([
    { ...interactive, policyVersion: -1 },
    { ...interactive, mode: "unknown" },
    { kind: "human", policyVersion: 0 },
    { kind: "ai", mode: "interactive" },
  ])("persisted unknown or incomplete authority fails closed", (origin) => {
    expect(aiOperationOriginSchema.safeParse(origin).success).toBeFalsy();
  });
});
