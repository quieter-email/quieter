import { describe, expect, test } from "vite-plus/test";

import {
  estimateInboundOrganizationMailUsage,
  estimateOutboundOrganizationMailUsage,
} from "../src/organization-mail-usage";
import {
  SES_INBOUND_CHUNK_BYTES,
  SES_INBOUND_CHUNK_MICROCENTS,
  SES_INBOUND_MESSAGE_MICROCENTS,
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
  });

  test("attributes inbound data proportionally without rounding each message up", () => {
    const estimate = estimateInboundOrganizationMailUsage({
      messageSizeBytes: SES_INBOUND_CHUNK_BYTES + 1,
      recipientCount: 1,
    });

    expect(estimate.incomingChunkCount).toBe(1);
    expect(estimate.sesCostMicroCents).toBe(
      SES_INBOUND_MESSAGE_MICROCENTS + SES_INBOUND_CHUNK_MICROCENTS + 1
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
    expect(
      1000 * (smallMessage.sesCostMicroCents - SES_INBOUND_MESSAGE_MICROCENTS)
    ).toBe(125 * SES_INBOUND_CHUNK_MICROCENTS);
  });
});
