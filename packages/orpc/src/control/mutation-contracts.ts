import { z } from "zod";

import { controlContracts, controlErrorSchema } from "./contracts";
import { CONTROL_API_VERSION } from "./openapi";

export const CONTROL_REVIEW_HEADER = "X-Quieter-Review";
export const CONTROL_REVIEW_INTENT = "approve";
export const controlMutationIdSchema = z.uuid();
export const controlMutationActionSchema = z.strictObject({
  id: controlMutationIdSchema,
});

const settingsInput = controlContracts["organization.settings.update"].input;
const patchFields = {
  allowPerSendOverride: settingsInput.shape.allowPerSendOverride,
  openTrackingEnabled: settingsInput.shape.openTrackingEnabled,
};

export const controlMutationPatchSchema = z
  .strictObject(patchFields)
  .refine(
    (value) =>
      value.allowPerSendOverride !== undefined ||
      value.openTrackingEnabled !== undefined,
    "Provide a settings change."
  );

export const controlMutationPrepareSchema = z
  .strictObject({
    ...patchFields,
    idempotencyKey: settingsInput.shape.idempotencyKey,
    organizationId: settingsInput.shape.organizationId,
  })
  .refine(
    (value) =>
      value.allowPerSendOverride !== undefined ||
      value.openTrackingEnabled !== undefined,
    "Provide a settings change."
  );

const instantSchema = z.iso.datetime({ offset: true });
const reviewBase = {
  createdAt: instantSchema,
  expiresAt: instantSchema,
  id: z.uuid(),
  operation: z.literal("organization.settings.update"),
  organizationId: settingsInput.shape.organizationId,
  organizationName: z.string(),
  patch: controlMutationPatchSchema,
  reviewPath: z
    .string()
    .regex(/^\/control\/review\?approvalId=[a-f0-9-]{36}$/u),
};

export const controlMutationReviewSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ ...reviewBase, status: z.literal("prepared") }),
    z.strictObject({
      ...reviewBase,
      approvedAt: instantSchema,
      status: z.literal("approved"),
    }),
    z.strictObject({
      ...reviewBase,
      approvedAt: instantSchema,
      completedAt: instantSchema,
      result: z.strictObject({
        allowPerSendOverride: z.boolean(),
        openTrackingEnabled: z.boolean(),
      }),
      status: z.literal("succeeded"),
    }),
    z.strictObject({
      ...reviewBase,
      approvedAt: instantSchema.nullable(),
      completedAt: instantSchema,
      error: controlErrorSchema.shape.error.strict(),
      status: z.literal("failed"),
    }),
    z.strictObject({
      ...reviewBase,
      approvedAt: instantSchema.nullable(),
      completedAt: instantSchema,
      status: z.literal("cancelled"),
    }),
    z.strictObject({
      ...reviewBase,
      approvedAt: instantSchema.nullable(),
      completedAt: instantSchema,
      status: z.literal("expired"),
    }),
  ])
  .refine(
    (value) => value.reviewPath === `/control/review?approvalId=${value.id}`
  );

export type ControlMutationPatch = z.infer<typeof controlMutationPatchSchema>;
export type ControlMutationPrepare = z.infer<
  typeof controlMutationPrepareSchema
>;
export type ControlMutationReview = z.infer<typeof controlMutationReviewSchema>;

export const fingerprintControlMutationRequest = async (input: {
  organizationId: string;
  patch: ControlMutationPatch;
}): Promise<string> => {
  const patch = controlMutationPatchSchema.parse(input.patch);
  const payload = JSON.stringify({
    operation: "organization.settings.update",
    organizationId: settingsInput.shape.organizationId.parse(
      input.organizationId
    ),
    patch: {
      ...(patch.allowPerSendOverride === undefined
        ? {}
        : { allowPerSendOverride: patch.allowPerSendOverride }),
      ...(patch.openTrackingEnabled === undefined
        ? {}
        : { openTrackingEnabled: patch.openTrackingEnabled }),
    },
    version: CONTROL_API_VERSION,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );
  return `v1:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
};
