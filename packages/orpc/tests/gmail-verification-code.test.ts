import type { MessageListItem } from "@quieter/gmail";
import { describe, expect, test } from "vite-plus/test";

import { getSenderServiceName } from "../src/gmail-useful-details/sender";
import { extractVerificationCode } from "../src/gmail-useful-details/verification-code";

const message = (input?: Partial<MessageListItem>): MessageListItem => ({
  id: "message-1",
  threadId: "thread-1",
  ...input,
});

const extractCode = (input: Partial<MessageListItem>) =>
  extractVerificationCode(message(input))?.code ?? null;

const HETZNER_HTML = `
<html>
  <head><style>.code { font-size: 24px; color: #e30613; letter-spacing: 4px; }</style></head>
  <body>
    <table><tr><td>Your client number: K1162177025</td></tr></table>
    <p>Dear Mr. Riefel,</p>
    <p>To ensure that only you have access to your account, please enter the following verification code:</p>
    <h2 class="code">944688</h2>
    <p>If you did not try to log in to your Hetzner account,
      <a href="https://accounts.hetzner.com/password/944688">please update your password immediately.</a></p>
    <p>Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Germany</p>
  </body>
</html>`;

describe("verification code extraction", () => {
  test("reads the code from a real provider layout", () => {
    expect(
      extractCode({
        bodyHtml: HETZNER_HTML,
        from: "noreply@hetzner.com",
        subject: "Your verification code",
      })
    ).toBe("944688");
  });

  test("never absorbs the word joining a label to its code", () => {
    expect(
      extractCode({
        bodyText: "Your Hetzner verification code is 944688.",
      })
    ).toBe("944688");
  });

  test.each([
    ["Your verification code is 944688.", "944688"],
    ["Your verification code: 944688", "944688"],
    ["Verification code\n944688", "944688"],
    ["Your code lautet 944688", "944688"],
    ["944688 is your verification code.", "944688"],
    ["944688 ist dein Bestätigungscode.", "944688"],
    ["Use code 123 456 to verify your sign-in.", "123456"],
    ["Your login code: 9 4 4 6 8 8", "944688"],
    ["Your one-time code is 944-688.", "944688"],
    ["Ihr Sicherheitscode lautet 483921.", "483921"],
    ["Ihr Verifizierungscode: 8391", "8391"],
    ["Enter the following code to sign in:\n\nAB12 CD34", "AB12CD34"],
    ["Please use passcode 04821 to confirm your identity.", "04821"],
    ["Your OTP is 55213", "55213"],
    ["PIN: 4711 (valid for 5 minutes)", "4711"],
    ["Ihr einmaliges Kennwort lautet 730154.", "730154"],
    ["Your Google verification code is 812345", "812345"],
    ["Your Apple ID Verification Code is: 483 921", "483921"],
    ["Security code: 4930182", "4930182"],
    ["Votre code de vérification est 483921.", "483921"],
    ["Tu código de verificación es 483921.", "483921"],
    ["Ihr Bestätigungscode für die Anmeldung lautet: 447 812", "447812"],
    ["Ihr Sicherheitscode für den Login lautet 918273.", "918273"],
  ] as const)("reads %j", (bodyText, expected) => {
    expect(extractCode({ bodyText, subject: "Verification" })).toBe(expected);
  });

  test("reads a code from a reverse-worded subject", () => {
    expect(
      extractCode({
        bodyText: "Slack sign-in confirmation",
        subject: "483921 is your Slack code",
      })
    ).toBe("483921");
  });

  test("reads a code that only appears in the subject", () => {
    expect(
      extractCode({
        bodyText: "Someone tried to sign in to your account.",
        subject: "782013 ist dein Verifizierungscode",
      })
    ).toBe("782013");
  });

  test("reads a standalone code below its label across paragraphs", () => {
    expect(
      extractCode({
        bodyHtml:
          "<p>Enter this verification code:</p><table><tr><td><b>3 9 1 8 2 4</b></td></tr></table>",
        subject: "Sign-in verification",
      })
    ).toBe("391824");
  });

  test.each([
    [
      "entity-encoded digits",
      "<p>Your verification code is <b>&#57;&#52;&#52;&#54;&#56;&#56;</b></p>",
    ],
    ["non-breaking spaces", "<p>Verification code:&nbsp;&nbsp;944688</p>"],
    [
      "nested tables",
      "<table><tbody><tr><td><table><tr><td>Your verification code</td></tr><tr><td><span>944688</span></td></tr></table></td></tr></tbody></table>",
    ],
    [
      "a hidden preheader repeating the code",
      "<div>944688 is your verification code</div><p>Your verification code is 944688</p>",
    ],
  ] as const)("reads a code through %s", (_name, bodyHtml) => {
    expect(extractCode({ bodyHtml, subject: "Verify" })).toBe("944688");
  });

  test.each([
    ["YOUR VERIFICATION CODE IS 944688"],
    ["Your verification code is **944688**!"],
    ['Your verification code is "944688".'],
    ["Verification code:\r\n\r\n944688\r\n\r\nThanks"],
    ["Your verification code is 9​4​4​6​8​8."],
    ["Order 4482190. Your verification code is 944688."],
    ["Your verification code is 944688. Order number 4482190."],
    ["Verification code: 944688\n\nCopyright 2026 Example Inc."],
    ["Verification code: 944688\n\nExample GmbH, 91710 Gunzenhausen"],
    ["Verification code 944688. Questions? Call +49 151 23456789."],
    ["Confirm your identity. Charge of 49.99 EUR. Verification code: 944688"],
  ] as const)("reads the right code in %j", (bodyText) => {
    expect(extractCode({ bodyText, subject: "Verify" })).toBe("944688");
  });

  test("counts a repeated code once instead of calling it ambiguous", () => {
    expect(
      extractCode({
        bodyText: "Your verification code is 482913.\nCode: 482913",
        subject: "482913 is your code",
      })
    ).toBe("482913");
  });
});

describe("verification code rejection", () => {
  test.each([
    ["Your order number is 123456 and the total is 42.00.", "Order"],
    ["Your client number: K1162177025", "Account"],
    ["Use promo code SAVE20 at checkout.", "Deals"],
    ["Your gift card code is ABCD1234.", "Gift"],
    ["Ihr Rabattcode lautet WINTER25.", "Angebot"],
    ["Your new password is Hunter42 for your account.", "Password"],
    ["Tracking number 1Z9992310192 is on its way.", "Delivery"],
    ["Your invoice number is 884213 and is due next week.", "Invoice"],
    ["Kundennummer: 1162177 - bitte bei Rückfragen angeben.", "Konto"],
    ["Call us at +49 151 23456789 for help.", "Support"],
    ["Verify at https://example.com/verify/944688 to continue.", "Verify"],
    ["Copyright 2026 Example. All rights reserved.", "Newsletter"],
    ["Your appointment is on 14.06.2026 at 09:30.", "Appointment"],
    ["Your area code is 0221 for this region.", "Info"],
    ["Use code SPRING20 at checkout.", "20% off"],
    ["Rate us 1 to 10. Your response code is 8842.", "Feedback"],
    [
      "Please verify the invoice number 8842130 before paying 42.00 EUR.",
      "Invoice 8842130",
    ],
    [
      "Two-factor authentication was disabled on your account on 14.06.2026.",
      "Two-factor authentication disabled",
    ],
    ["A new sign-in from Berlin at 09:30 on 14.06.2026.", "New sign-in"],
    ["Recovery codes:\n1234-5678\n2345-6789\n3456-7890", "Your recovery codes"],
    ["Verification code 112233 or 445566", "Verification"],
    ["", ""],
  ] as const)("rejects %j", (bodyText, subject) => {
    expect(extractCode({ bodyText, subject })).toBeNull();
  });

  test("ignores a code that only exists in markup attributes", () => {
    expect(
      extractCode({
        bodyHtml: "<p>Your verification code</p><img alt='944688' src='x.png'>",
        subject: "Verify",
      })
    ).toBeNull();
  });

  test("rejects a message offering two equally plausible codes", () => {
    expect(
      extractCode({
        bodyText:
          "Your verification code is 123456.\nYour backup code is 654321.",
        subject: "Codes",
      })
    ).toBeNull();
  });

  test("ignores digits that only exist in stylesheets", () => {
    expect(
      extractCode({
        bodyHtml:
          "<style>.a{width:640811px;margin:4821 0}</style><p>Your account was updated.</p>",
        subject: "Account",
      })
    ).toBeNull();
  });

  test("rejects a bare number with no verification context", () => {
    expect(
      extractCode({ bodyText: "Reference\n\n884213", subject: "Statement" })
    ).toBeNull();
  });

  test("rejects a code split across an unreadable pair of halves", () => {
    expect(
      extractCode({
        bodyText: "Your verification code is ABCD 1234.",
        subject: "Verification",
      })
    ).toBeNull();
  });
});

describe("verification code validity", () => {
  test("defaults to a thirty minute window", () => {
    expect(
      extractVerificationCode(
        message({ bodyText: "Your verification code is 944688." })
      )
    ).toMatchObject({
      code: "944688",
      hasExplicitValidity: false,
      validForMs: 1000 * 60 * 30,
    });
  });

  test.each([
    [
      "Your verification code is 944688. It expires in 10 minutes.",
      1000 * 60 * 10,
    ],
    ["Verification code 944688 is valid for 90 seconds.", 1000 * 90],
    ["Verification code 944688 is valid for 20 seconds.", 1000 * 60],
    ["Ihr Bestätigungscode 944688 ist 15 Minuten gültig.", 1000 * 60 * 15],
    ["Your login code 944688 expires in 24 hours.", 1000 * 60 * 60 * 2],
  ] as const)("reads the stated validity in %j", (bodyText, validForMs) => {
    expect(extractVerificationCode(message({ bodyText }))).toMatchObject({
      hasExplicitValidity: true,
      validForMs,
    });
  });
});

describe("sender service names", () => {
  test.each([
    ["noreply@hetzner.com", "Hetzner"],
    ["Hetzner Online GmbH <noreply@hetzner.com>", "Hetzner Online"],
    ["Example <login@example.com>", "Example"],
    ["no-reply@accounts.google.com", "Google"],
    ["Notifications <notify@my-bank.co.uk>", "My-Bank"],
    ["security@github.com", "Github"],
    ["<noreply@hetzner.com>", "Hetzner"],
  ] as const)("names %j", (from, expected) => {
    expect(getSenderServiceName(from)).toBe(expected);
  });

  test("returns null without a usable sender", () => {
    expect(getSenderServiceName(null)).toBeNull();
    expect(getSenderServiceName("")).toBeNull();
  });
});
