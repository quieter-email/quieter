"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";

export const RecordState = ({
  message,
  ok,
}: {
  message: string;
  ok: boolean | null;
}) => {
  let tone: PillTone = "neutral";
  if (ok === true) {
    tone = "success";
  } else if (ok === false) {
    tone = "destructive";
  }

  return <Pill tone={tone}>{message}</Pill>;
};

export type DomainStatusTone = "success" | "warning" | "error" | "neutral";

export const getDomainVerificationStatus = ({
  domainStatus,
  isVerified,
  passingRecords,
  remainingRecords,
  sendingReady,
  totalRecords,
}: {
  domainStatus: string;
  isVerified: boolean;
  passingRecords: number;
  remainingRecords: number;
  sendingReady: boolean;
  totalRecords: number;
}) => {
  if (isVerified) {
    return {
      description: sendingReady
        ? "Every required check is passing."
        : "All DNS records are ready. Sending may still catch up for a short while.",
      label: "Verified",
      tone: "success" as const satisfies DomainStatusTone,
    };
  }
  if (remainingRecords > 0 && passingRecords > 0) {
    return {
      description: `${passingRecords} of ${totalRecords} DNS records are ready. Fix the remaining ${remainingRecords}.`,
      label: "Partially verified",
      tone: "warning" as const satisfies DomainStatusTone,
    };
  }
  if (domainStatus === "failed") {
    return {
      description: "Required DNS records are missing or incorrect.",
      label: "Check failed",
      tone: "error" as const satisfies DomainStatusTone,
    };
  }
  return {
    description: "Add the required DNS records, then run verification.",
    label: "Pending DNS",
    tone: "neutral" as const satisfies DomainStatusTone,
  };
};

export type DomainDetail = RouterOutputs["mailDomains"]["get"]["domain"];

export type DomainDnsCheck = NonNullable<
  DomainDetail["lastCheckResult"]
>["checks"][number];
