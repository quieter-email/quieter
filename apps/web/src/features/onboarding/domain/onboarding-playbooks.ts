import type { RouterOutputs } from "@quieter/orpc";

export type OnboardingMailDomain = NonNullable<
  RouterOutputs["onboarding"]["getState"]
>["domains"][number];

export type MailDomainPartitions = {
  pendingReceiving: OnboardingMailDomain[];
  pendingSending: OnboardingMailDomain[];
  verifiedReceiving: OnboardingMailDomain[];
  verifiedSending: OnboardingMailDomain[];
};

/**
 * Any verified domain can send; receiving additionally needs send-and-receive
 * mode, so the sending and custom-inbox playbooks derive their state from
 * different partitions.
 */
export const partitionMailDomains = (
  domains: OnboardingMailDomain[]
): MailDomainPartitions => ({
  pendingReceiving: domains.filter(
    (domain) =>
      domain.mode === "send_and_receive" && domain.status !== "verified"
  ),
  pendingSending: domains.filter((domain) => domain.status !== "verified"),
  verifiedReceiving: domains.filter(
    (domain) =>
      domain.mode === "send_and_receive" && domain.status === "verified"
  ),
  verifiedSending: domains.filter((domain) => domain.status === "verified"),
});
