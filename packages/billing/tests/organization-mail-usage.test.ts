import { describe, expect, test } from "vite-plus/test";
import {
  estimateInboundOrganizationMailUsage,
  estimateOutboundOrganizationMailUsage,
  normalizeOrganizationMailAlertMilestones,
} from "../src/organization-mail-usage";
import {
  applyManagedUsageMarkup,
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

  test("attributes inbound data proportionally without rounding each message up", () => {
    const estimate = estimateInboundOrganizationMailUsage({
      messageSizeBytes: SES_INBOUND_CHUNK_BYTES + 1,
      recipientCount: 1,
    });

    expect(estimate.incomingChunkCount).toBe(1);
    expect(estimate.sesCostMicroCents).toBe(
      SES_INBOUND_MESSAGE_MICROCENTS + SES_INBOUND_CHUNK_MICROCENTS + 1,
    );

    const incompleteChunk = estimateInboundOrganizationMailUsage({
      messageSizeBytes: 255 * 1024,
      recipientCount: 1,
    });

    expect(incompleteChunk.incomingChunkCount).toBe(0);

    const smallMessage = estimateInboundOrganizationMailUsage({
      messageSizeBytes: 32 * 1024,
      recipientCount: 1,
    });

    expect(smallMessage.incomingChunkCount).toBe(0);
    expect(1_000 * (smallMessage.sesCostMicroCents - SES_INBOUND_MESSAGE_MICROCENTS)).toBe(
      125 * SES_INBOUND_CHUNK_MICROCENTS,
    );
  });

  test("normalizes alert milestones", () => {
    expect(normalizeOrganizationMailAlertMilestones([100, 50.2, 50, 0, 101])).toEqual([50, 100]);
  });

  test("applies the configured managed mail margins", () => {
    const rates = getManagedUsageRates();

    expect(rates.messagesPerThousandUsd).toBeCloseTo(0.2);
    expect(rates.attachmentDataPerGbUsd).toBeCloseTo(0.24);
    expect(rates.inboundProcessingPerThousandUsd).toBeCloseTo(0.18);
  });

  test("applies markup directly to the SES USD cost", () => {
    expect(
      applyManagedUsageMarkup({
        sesCostUsdMicroCents: SES_OUTBOUND_MESSAGE_MICROCENTS * 1_000,
      }),
    ).toBe(20_000_000);
  });
});
