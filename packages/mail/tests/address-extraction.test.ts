import { describe, expect, test } from "vite-plus/test";

import {
  composeRecipientFieldsSchema,
  extractMailAddress,
  getMailAddressKey,
  splitMailAddressList,
} from "../src/compose/schema";
import {
  getSendEnvelopeAddress,
  getSendEnvelopeAddressList,
  sendMessageInputSchema,
} from "../src/send";

const message = {
  from: "sender@example.com",
  subject: "Hello",
  text: "Hello",
  to: "recipient@example.com",
};

const malformedAddresses = [
  `a${" ".repeat(8000)}X`,
  `a${"\t".repeat(8000)}X`,
  `a${" \t".repeat(4000)}<recipient@example.com> trailing`,
  `a${" ".repeat(8000)}<recipient@example.com`,
  `a${" ".repeat(8000)}<recipient@example.com>>`,
];

describe("shared address extraction", () => {
  test.each([
    "recipient@example.com",
    " Demo <recipient@example.com> ",
    "<recipient@example.com>",
    "Demo    Name < recipient@example.com >",
    '"billing@trusted.example" <recipient@example.com>',
    '"Demo <team>" <recipient@example.com>',
    '"Demo \\"team\\"" <recipient@example.com>',
    '"Demo \\\\ team" <recipient@example.com>',
    "Demo\r\n Name <recipient@example.com>",
    `Demo${" ".repeat(8000)}<recipient@example.com>`,
  ])("preserves a supported mailbox form %#", (value) => {
    expect(extractMailAddress(value)).toBe("recipient@example.com");
    expect(getSendEnvelopeAddress(value)).toBe("recipient@example.com");
    expect(getMailAddressKey(value)).toBe("recipient@example.com");
    expect(
      sendMessageInputSchema.safeParse({ ...message, from: value }).success
    ).toBeTruthy();
  });

  test.each([
    '"Unclosed <recipient@example.com>',
    "Demo <nested<recipient@example.com>>",
    "Demo <recipient@example.com> Other <other@example.com>",
    "Demo <> ignored",
    ...malformedAddresses,
  ])("retains malformed text for validation to reject %#", (value) => {
    expect(extractMailAddress(value)).toBe(value);
    expect(
      sendMessageInputSchema.safeParse({ ...message, from: value }).success
    ).toBeFalsy();
  });

  test.each(["to", "cc", "bcc", "replyTo"])(
    "rejects adversarial string and array inputs in %s",
    (field) => {
      for (const value of malformedAddresses) {
        expect(
          sendMessageInputSchema.safeParse({ ...message, [field]: value })
            .success
        ).toBeFalsy();
        expect(
          sendMessageInputSchema.safeParse({ ...message, [field]: [value] })
            .success
        ).toBeFalsy();
      }
    }
  );

  test("shares extraction with compose lists and direct envelope consumers", () => {
    const list =
      '"Demo, Team" <Recipient@Example.com>; Other <other@example.com>';
    expect(
      composeRecipientFieldsSchema.safeParse({ bcc: "", cc: "", to: list })
        .success
    ).toBeTruthy();
    expect(
      getSendEnvelopeAddressList(splitMailAddressList(list))
    ).toStrictEqual(["recipient@example.com", "other@example.com"]);
    for (const field of ["to", "cc", "bcc"]) {
      for (const value of malformedAddresses) {
        expect(
          composeRecipientFieldsSchema.safeParse({
            bcc: "",
            cc: "",
            to: "recipient@example.com",
            [field]: value,
          }).success
        ).toBeFalsy();
      }
    }
  });
});
