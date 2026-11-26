import type { webReleasePlanSchema } from "@quieter/env/deployment";
import type { z } from "zod";

export const WEB_RELEASE_SLOTS = [
  {
    componentName: "WebReleaseA",
    serviceName: "quieter-production-web-release-a",
    slot: "a",
  },
  {
    componentName: "WebReleaseB",
    serviceName: "quieter-production-web-release-b",
    slot: "b",
  },
] as const;

type WebReleaseSlot = (typeof WEB_RELEASE_SLOTS)[number];

export const assertSstWebReleasePlan = (input: {
  plan: z.infer<typeof webReleasePlanSchema>;
  nativeMode: boolean;
  cutoverBuildId?: string;
}) => {
  const { plan, nativeMode, cutoverBuildId } = input;
  if (
    plan.manifest.current.versionId !== undefined ||
    plan.manifest.previous?.versionId !== undefined ||
    plan.sourceDeployment?.versionId !== undefined
  ) {
    throw new Error("SST requires the legacy web routing manifest.");
  }
  if (
    nativeMode &&
    (plan.updateSlot !== null || cutoverBuildId !== undefined)
  ) {
    throw new Error(
      "Native infrastructure sync requires the same legacy build and skips mail cutover."
    );
  }
};

type WebReleaseScope =
  | {
      kind: "bootstrap";
      excludedSlots: readonly [];
      promotionSlots: typeof WEB_RELEASE_SLOTS;
    }
  | {
      kind: "advance";
      excludedSlots: readonly [WebReleaseSlot];
      promotionSlots: readonly [WebReleaseSlot];
    }
  | {
      kind: "same-build";
      excludedSlots: typeof WEB_RELEASE_SLOTS;
      promotionSlots: readonly [];
    };

export const deriveWebReleaseScope = (
  plan: z.infer<typeof webReleasePlanSchema>
): WebReleaseScope => {
  if (plan.updateSlot === null) {
    return {
      excludedSlots: WEB_RELEASE_SLOTS,
      kind: "same-build",
      promotionSlots: [],
    };
  }
  if (plan.manifest.previous === null) {
    return {
      excludedSlots: [],
      kind: "bootstrap",
      promotionSlots: WEB_RELEASE_SLOTS,
    };
  }
  const [a, b] = WEB_RELEASE_SLOTS;
  return {
    excludedSlots: [plan.manifest.previous.slot === "a" ? a : b],
    kind: "advance",
    promotionSlots: [plan.updateSlot === "a" ? a : b],
  };
};
