import {
  parseRawMailAttachments,
  parseRawMailMessage,
} from "@quieter/mail/raw-message";
import { sendMessageInputSchema } from "@quieter/mail/send";
import { buildSendMimeMessage } from "@quieter/mail/send-mime";
import { describe, expect, test } from "vite-plus/test";

describe("Worker MIME composition", () => {
  test("builds MIME using the Worker Node runtime without file or network access", async () => {
    const built = await buildSendMimeMessage(
      sendMessageInputSchema.parse({
        attachments: [
          {
            content: Buffer.from("file bytes").toString("base64"),
            filename: "Résumé.txt",
          },
        ],
        from: "sender@example.com",
        subject: "漢字 📨",
        text: "Hello",
        to: "recipient@example.com",
      })
    );
    const raw = new TextEncoder().encode(built.raw);
    const parsed = await parseRawMailMessage(raw);
    const attachments = await parseRawMailAttachments(raw);
    expect(parsed.subject).toBe("漢字 📨");
    expect(attachments[0]?.fileName).toBe("Résumé.txt");
    expect(new TextDecoder().decode(attachments[0]?.content)).toBe(
      "file bytes"
    );
  });
});
