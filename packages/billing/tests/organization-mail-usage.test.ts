import { describe, expect, test } from "bun:test";
import {
  estimateInboundOrganizationMailUsage,
  estimateOutboundOrganizationMailUsage,
  normalizeOrganizationMailAlertMilestones,
} from "../src/organization-mail-usage";
import {
  getManagedUsageRates,
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

  test("gives Pro cleaner, lower managed mail rates", () => {
    const teamRates = getManagedUsageRates("managed");
    const teamAiRates = getManagedUsageRates("pro");

    expect(teamRates.messagesPerThousandDollars).toBeCloseTo(0.2);
    expect(teamAiRates.messagesPerThousandDollars).toBeCloseTo(0.15);
    expect(teamRates.attachmentDataPerGbDollars).toBeCloseTo(0.24);
    expect(teamAiRates.attachmentDataPerGbDollars).toBeCloseTo(0.18);
    expect(teamRates.inboundProcessingPerThousandDollars).toBeCloseTo(0.18);
    expect(teamAiRates.inboundProcessingPerThousandDollars).toBeCloseTo(0.135);
    expect(teamRates.markupPercent).toBe(100);
    expect(teamAiRates.markupPercent).toBe(50);
  });
});
