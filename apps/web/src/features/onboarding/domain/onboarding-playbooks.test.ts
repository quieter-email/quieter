import { describe, expect, it } from "vite-plus/test";

import { partitionMailDomains } from "./onboarding-playbooks";
import type { OnboardingMailDomain } from "./onboarding-playbooks";

const domain = (
  overrides: Partial<Pick<OnboardingMailDomain, "domain" | "mode" | "status">> &
    Pick<OnboardingMailDomain, "id">
): OnboardingMailDomain => ({
  domain: "example.com",
  mode: "send_only",
  status: "verified",
  ...overrides,
});

describe(partitionMailDomains, () => {
  it("splits domains by verification and receive capability", () => {
    const partitions = partitionMailDomains([
      domain({ domain: "send-only.com", id: "1" }),
      domain({
        domain: "receive-pending.com",
        id: "2",
        mode: "send_and_receive",
        status: "pending_dns",
      }),
      domain({ domain: "both.com", id: "3", mode: "send_and_receive" }),
      domain({ domain: "failed.com", id: "4", status: "failed" }),
    ]);

    expect(
      partitions.verifiedSending.map((entry) => entry.domain)
    ).toStrictEqual(["send-only.com", "both.com"]);
    expect(
      partitions.pendingSending.map((entry) => entry.domain)
    ).toStrictEqual(["receive-pending.com", "failed.com"]);
    expect(
      partitions.verifiedReceiving.map((entry) => entry.domain)
    ).toStrictEqual(["both.com"]);
    expect(
      partitions.pendingReceiving.map((entry) => entry.domain)
    ).toStrictEqual(["receive-pending.com"]);
  });

  it("treats send-only pending domains as sending work only", () => {
    const partitions = partitionMailDomains([
      domain({ id: "1", status: "pending_dns" }),
    ]);

    expect(partitions.pendingReceiving).toStrictEqual([]);
    expect(partitions.pendingSending).toHaveLength(1);
  });

  it("returns empty partitions for no domains", () => {
    expect(partitionMailDomains([])).toStrictEqual({
      pendingReceiving: [],
      pendingSending: [],
      verifiedReceiving: [],
      verifiedSending: [],
    });
  });
});
