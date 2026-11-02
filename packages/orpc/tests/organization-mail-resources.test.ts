import { MAX_SEND_ATTACHMENTS } from "@quieter/mail/send";
import type { buildSendMimeMessage } from "@quieter/mail/send-mime";
import { describe, expect, test, vi } from "vite-plus/test";
import { ZodError } from "zod";

import type { sendPreparedMail } from "../src/mail-send";
import { sendOrganizationMailMessage } from "../src/organization-mail";
import type {
  buildOpenTrackingHtmlTransform,
  resolveOrganizationMailOpenTracking,
} from "../src/organization-mail-delivery";

const mocks = vi.hoisted(() => ({
  buildMime: vi.fn<typeof buildSendMimeMessage>(),
  resolveTracking: vi.fn<typeof resolveOrganizationMailOpenTracking>(),
  send: vi.fn<typeof sendPreparedMail>(),
}));

vi.mock(import("@quieter/mail/send-mime"), () => ({
  buildSendMimeMessage: mocks.buildMime,
}));
vi.mock(import("../src/organization-mail-delivery"), () => ({
  buildOpenTrackingHtmlTransform:
    vi.fn<typeof buildOpenTrackingHtmlTransform>(),
  resolveOrganizationMailOpenTracking: mocks.resolveTracking,
}));
vi.mock(import("../src/mail-send"), () => ({ sendPreparedMail: mocks.send }));

describe("organization outbound attachment resources", () => {
  test("rejects oversized internal attachment sets before preparation or delivery", async () => {
    const attachments = Array.from(
      { length: MAX_SEND_ATTACHMENTS + 1 },
      () => ({
        content: "",
        contentType: "application/octet-stream",
        disposition: "attachment" as const,
        filename: "empty.txt",
      })
    );
    await expect(
      sendOrganizationMailMessage({
        message: {
          attachments,
          from: "sender@example.com",
          subject: "Hello",
          tags: [],
          text: "Hello",
          to: ["recipient@example.com"],
        },
        organizationId: "synthetic-team",
      })
    ).rejects.toThrow(ZodError);
    expect(mocks.resolveTracking).not.toHaveBeenCalled();
    expect(mocks.buildMime).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
