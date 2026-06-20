import { describe, expect, test } from "bun:test";
import {
  estimateInboundOrganizationMailUsage,
  estimateOutboundOrganizationMailUsage,
  normalizeOrganizationMailAlertMilestones,
} from "../src/organization-mail-usage";
import {
  SES_INBOUND_CHUNK_BYTES,
  SES_INBOUND_CHUNK_MICROCENTS,
  SES_INBOUND_MESSAGE_MICROCENTS,
  SES_OUTBOUND_MESSAGE_MICROCENTS,
} from "../src/ses-pricing";

describe("organization mail usage", () => {
  test("deduplicates recipients when estimating outbound usage", () => {
    const estimate = estimateOutboundOrganizationMailUsage({
      bcc: ["one@example.com"],
      cc: ["two@example.com"],
      subject: "Subject",
      text: "Body",
      to: ["one@example.com", "two@example.com"],
    });

    expect(estimate.recipientCount).toBe(2);
    expect(estimate.messageCount).toBe(2);
    expect(estimate.sesCostMicroCents).toBe(2 * SES_OUTBOUND_MESSAGE_MICROCENTS);
  });

  test("charges inbound data in whole provider chunks", () => {
    const estimate = estimateInboundOrganizationMailUsage({
      messageSizeBytes: SES_INBOUND_CHUNK_BYTES + 1,
      recipientCount: 1,
    });

    expect(estimate.incomingChunkCount).toBe(2);
    expect(estimate.sesCostMicroCents).toBe(
      SES_INBOUND_MESSAGE_MICROCENTS + 2 * SES_INBOUND_CHUNK_MICROCENTS,
    );
  });

  test("normalizes alert milestones", () => {
    expect(normalizeOrganizationMailAlertMilestones([100, 50.2, 50, 0, 101])).toEqual([50, 100]);
  });
});
