import { describe, expect, test } from "bun:test";
import { parseMailtoComposeDraft } from "./mailto";

const getParsedFields = (value: string) => {
  const draft = parseMailtoComposeDraft(value);

  return draft
    ? {
        bodyText: draft.bodyText,
        recipients: draft.recipients,
        subject: draft.subject,
      }
    : null;
};

describe("parseMailtoComposeDraft", () => {
  test("parses multiple recipients from the path", () => {
    expect(getParsedFields("mailto:alex@example.com,jamie@example.com")).toEqual({
      bodyText: "",
      recipients: {
        bcc: "",
        cc: "",
        to: "alex@example.com, jamie@example.com",
      },
      subject: "",
    });
  });

  test("parses to query recipients", () => {
    expect(getParsedFields("mailto:?to=alex%40example.com&to=jamie%40example.com")).toEqual({
      bodyText: "",
      recipients: {
        bcc: "",
        cc: "",
        to: "alex@example.com, jamie@example.com",
      },
      subject: "",
    });
  });

  test("decodes subject, body, and newline body text", () => {
    expect(
      getParsedFields(
        "mailto:alex%40example.com?subject=Hello%20there&body=Line%201%0D%0ALine%202",
      ),
    ).toEqual({
      bodyText: "Line 1\r\nLine 2",
      recipients: {
        bcc: "",
        cc: "",
        to: "alex@example.com",
      },
      subject: "Hello there",
    });
  });

  test("parses cc and bcc recipients", () => {
    expect(
      getParsedFields(
        "mailto:alex@example.com?cc=casey%40example.com,lee%40example.com&bcc=sam%40example.com",
      ),
    ).toEqual({
      bodyText: "",
      recipients: {
        bcc: "sam@example.com",
        cc: "casey@example.com, lee@example.com",
        to: "alex@example.com",
      },
      subject: "",
    });
  });

  test("returns null for malformed and non-mailto input", () => {
    expect(parseMailtoComposeDraft("https://example.com")).toBeNull();
    expect(parseMailtoComposeDraft("mailto:%E0%A4%A")).toBeNull();
  });

  test("ignores empty values", () => {
    expect(getParsedFields("mailto:?to=&cc=&bcc=&subject=&body=")).toEqual({
      bodyText: "",
      recipients: {
        bcc: "",
        cc: "",
        to: "",
      },
      subject: "",
    });
  });
});
