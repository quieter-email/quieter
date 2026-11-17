import { createHash } from "node:crypto";

import { describe, expect, test } from "vite-plus/test";

import {
  controlMutationPrepareSchema,
  controlMutationReviewSchema,
  fingerprintControlMutationRequest,
} from "../src/control/mutation-contracts";
import { CONTROL_API_VERSION } from "../src/control/openapi";

describe("local settings mutation contracts", () => {
  test("requires an explicit team and a change without accepting authority or approval claims", () => {
    const request = {
      idempotencyKey: "change-a",
      openTrackingEnabled: false,
      organizationId: "team-a",
    };
    const parsed = controlMutationPrepareSchema.parse(request);
    expect(parsed).toMatchObject({ openTrackingEnabled: false });
    expect("allowPerSendOverride" in parsed).toBeFalsy();
    for (const invalid of [
      { ...request, actorUserId: "another-user" },
      { ...request, credentialId: "another-session" },
      { ...request, role: "owner" },
      { ...request, confirmed: true },
      { ...request, approvalId: "unreviewed" },
      { ...request, organizationId: " " },
      { ...request, openTrackingEnabled: "false" },
      { idempotencyKey: "change-a", organizationId: "team-a" },
    ]) {
      expect(
        controlMutationPrepareSchema.safeParse(invalid).success
      ).toBeFalsy();
    }
  });

  test("fingerprints the versioned operation, explicit team and ordered supplied patch", async () => {
    const first = await fingerprintControlMutationRequest({
      organizationId: "team-a",
      patch: { allowPerSendOverride: true, openTrackingEnabled: false },
    });
    const reordered = await fingerprintControlMutationRequest({
      organizationId: "team-a",
      patch: { allowPerSendOverride: true, openTrackingEnabled: false },
    });
    const expected = createHash("sha256")
      .update(
        JSON.stringify({
          operation: "organization.settings.update",
          organizationId: "team-a",
          patch: { allowPerSendOverride: true, openTrackingEnabled: false },
          version: CONTROL_API_VERSION,
        })
      )
      .digest("hex");
    expect(first).toBe(reordered);
    expect(first).toBe(`v1:${expected}`);
    expect(first).toMatch(/^v1:[a-f0-9]{64}$/u);
    const omitted = await fingerprintControlMutationRequest({
      organizationId: "team-a",
      patch: { allowPerSendOverride: true },
    });
    const otherTeam = await fingerprintControlMutationRequest({
      organizationId: "team-b",
      patch: { allowPerSendOverride: true, openTrackingEnabled: false },
    });
    expect(first).not.toBe(omitted);
    expect(first).not.toBe(otherTeam);
  });

  test("keeps success results and safe failures exclusive to their terminal states", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const base = {
      createdAt: "2026-11-16T10:00:00Z",
      expiresAt: "2026-11-16T10:10:00Z",
      id,
      operation: "organization.settings.update",
      organizationId: "team-a",
      organizationName: "Team A",
      patch: { openTrackingEnabled: false },
      reviewPath: `/control/review?approvalId=${id}`,
    };
    const approvedAt = "2026-11-16T10:01:00Z";
    const completedAt = "2026-11-16T10:02:00Z";
    const result = { allowPerSendOverride: true, openTrackingEnabled: false };
    expect(
      controlMutationReviewSchema.parse({ ...base, status: "prepared" })
    ).toMatchObject({ patch: { openTrackingEnabled: false } });
    expect(
      controlMutationReviewSchema.safeParse({
        ...base,
        approvedAt,
        completedAt,
        result,
        status: "succeeded",
      }).success
    ).toBeTruthy();
    expect(
      controlMutationReviewSchema.safeParse({
        ...base,
        approvedAt: null,
        completedAt,
        error: { code: "CONFLICT", message: "Review this change." },
        status: "failed",
      }).success
    ).toBeTruthy();
    for (const invalid of [
      { ...base, result, status: "prepared" },
      { ...base, status: "approved" },
      { ...base, approvedAt, completedAt, status: "succeeded" },
      {
        ...base,
        approvedAt,
        completedAt,
        result: { openTrackingEnabled: false },
        status: "succeeded",
      },
      {
        ...base,
        approvedAt,
        completedAt,
        error: { code: "UNKNOWN", message: "Private detail" },
        status: "failed",
      },
      {
        ...base,
        approvedAt,
        completedAt,
        error: {
          cause: "private query",
          code: "CONFLICT",
          message: "Review this change.",
        },
        status: "failed",
      },
      {
        ...base,
        reviewPath: "https://example.test/review",
        status: "prepared",
      },
      {
        ...base,
        reviewPath: `/control/review/${id}`,
        status: "prepared",
      },
      {
        ...base,
        reviewPath:
          "/control/review?approvalId=123e4567-e89b-42d3-a456-426614174001",
        status: "prepared",
      },
      { ...base, credentialId: "private-session", status: "prepared" },
    ]) {
      expect(
        controlMutationReviewSchema.safeParse(invalid).success
      ).toBeFalsy();
    }
  });
});
