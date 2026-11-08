import PostalMime from "postal-mime";
import { describe, expect, test } from "vite-plus/test";
import { ZodError } from "zod";

import { assertRawMailSender } from "../src/raw-message";
import {
  MAX_SEND_ATTACHMENTS,
  parseSendSender,
  sendMessageInputSchema,
} from "../src/send";
import { buildSendMimeMessage } from "../src/send-mime";

const baseMessage = {
  attachments: [],
  from: "demo@example.com",
  subject: "Hello",
  tags: [],
  text: "Hello",
  to: ["to@example.com"],
};

const attachment = {
  content: "YQ==",
  contentType: "text/plain",
  disposition: "attachment" as const,
  filename: "hello.txt",
};

describe("attachment resource limits", () => {
  test("rejects excessive attachments before reading their content", async () => {
    let reads = 0;
    const attachments = Array.from(
      { length: MAX_SEND_ATTACHMENTS + 1 },
      () => ({
        ...attachment,
        get content() {
          reads += 1;
          return "YQ==";
        },
      })
    );
    expect(
      sendMessageInputSchema.safeParse({ ...baseMessage, attachments }).success
    ).toBeFalsy();
    await expect(
      buildSendMimeMessage({ ...baseMessage, attachments })
    ).rejects.toThrow(ZodError);
    expect(reads).toBe(0);
  });
});

describe("send message input schema", () => {
  test.each([
    "victim@victim.example ( <sender@attacker.example>",
    "Victim (comment) <sender@example.com>",
    "Team: sender@example.com;",
    "one@example.com, Two <two@example.com>",
    "Name <sender@example.com> trailing",
    '"Unclosed <sender@example.com>',
    "Name\r\n <sender@example.com>",
    "\r\nsender@example.com",
    "sender@example.com\r\n",
    `Name${" ".repeat(4000)}<sender@example.com`,
    `Name${" ".repeat(4000)}<sender@example.com> trailing`,
    `Name${" ".repeat(4000)}<sender@example.com>>`,
    `"Name${" ".repeat(4000)}\\" <sender@example.com>`,
  ])("rejects ambiguous sender syntax %#", async (from) => {
    expect(parseSendSender(from)).toBeNull();
    const message = {
      attachments: [],
      from,
      subject: "Hello",
      tags: [],
      text: "Hello",
      to: ["to@example.com"],
    };
    expect(sendMessageInputSchema.safeParse(message).success).toBeFalsy();
    await expect(buildSendMimeMessage(message)).rejects.toThrow(/sender/iu);
  });

  test.each([
    "sender@example.com",
    "Demo Team <Sender@Example.com>",
    '"Doe, Jane (team): sales;" <sender@example.com>',
    '"Jane \\"JJ\\" Doe" <sender@example.com>',
    "日本語 <sender@example.com>",
    '"Team <sales>, \\"quoted\\" >" <sender@example.com>',
    "<sender@example.com>",
    `Team${" ".repeat(4000)}<sender@example.com>`,
    `"${"日本語 ".repeat(50)}" <sender@example.com>`,
  ])(
    "keeps serialized sender equal to the canonical identity %#",
    async (from) => {
      const message = sendMessageInputSchema.parse({
        from,
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      });
      const built = await buildSendMimeMessage(message);
      const parsed = await PostalMime.parse(built.raw);
      expect(parsed.from).toMatchObject({ address: built.fromAddress });
      expect(parsed.headers.filter(({ key }) => key === "from")).toHaveLength(
        1
      );
    }
  );

  test("rejects structural custom headers", () => {
    const result = sendMessageInputSchema.safeParse({
      from: "demo@example.com",
      headers: { Subject: "Injected" },
      subject: "Hello",
      text: "Hello",
      to: ["to@example.com"],
    });

    expect(result.success).toBeFalsy();
  });
});

describe("build send MIME message", () => {
  test.each([
    "From: victim@victim.example\r\n",
    "From: sender@example.com\r\nFrom: victim@victim.example\r\n",
    "From: Team: sender@example.com;\r\n",
    "From: sender@example.com, victim@victim.example\r\n",
    "Sender: sender@example.com\r\n",
  ])(
    "blocks inconsistent raw sender headers before delivery %s",
    async (headers) => {
      await expect(
        assertRawMailSender(`${headers}\r\nHello`, "sender@example.com")
      ).rejects.toThrow(/sender/iu);
    }
  );
});
