import { describe, expect, test } from "vite-plus/test";

import { prepareReportedEvent } from "../src/index";

describe("reported event preparation", () => {
  test("drops expected mailbox authorization states", () => {
    const cause = Object.assign(new Error("Mailbox scope repair required."), {
      code: "MAILBOX_SCOPE_REPAIR_REQUIRED",
    });
    const error = new Error("Outer failure", { cause });

    expect(prepareReportedEvent({}, error)).toBeNull();
  });

  test("strips database query text and request context", () => {
    const message =
      'Failed query: select "id" from "mailbox" where "emailAddress" = $1\nparams: person@example.com,1';
    const event = prepareReportedEvent(
      {
        exception: {
          values: [{ type: "DrizzleQueryError", value: message }],
        },
        extra: { params: "person@example.com" },
        message,
        request: { url: "https://worker.invalid/gmail/pubsub" },
        transaction: "POST /gmail/pubsub",
        user: { id: "ip:127.0.0.1" },
      },
      new Error(message)
    );

    expect(event?.exception?.values?.[0]?.value).toBe("Database query failed.");
    expect(event?.message).toBe("Database query failed.");
    expect(event?.extra).toBeUndefined();
    expect(event?.request).toBeUndefined();
    expect(event?.transaction).toBeUndefined();
    expect(event?.user).toBeUndefined();
  });

  test("removes model response content from parsing failures without losing diagnostics", () => {
    const privateContent = "synthetic-private-access-code";
    const event = prepareReportedEvent(
      {
        exception: {
          values: [
            { type: "SyntaxError", value: `Invalid JSON: ${privateContent}` },
            {
              type: "AI_JSONParseError",
              value: `JSON parsing failed: ${privateContent}`,
            },
            {
              stacktrace: {
                frames: [{ filename: "generation.js", lineno: 42 }],
              },
              type: "AI_NoObjectGeneratedError",
              value: "No object generated",
            },
          ],
        },
        message: `Generation failed: ${privateContent}`,
      },
      new Error("Generation failed")
    );
    const serialized = JSON.stringify(event);

    expect(event).not.toBeNull();
    expect(serialized).not.toContain(privateContent);
    expect(serialized).toContain("AI_NoObjectGeneratedError");
    expect(serialized).toContain("generation.js");
  });

  test.each([
    "AI_NoObjectGeneratedError",
    "AI_JSONParseError",
    "AI_TypeValidationError",
  ])("recognizes a wrapped %s when event metadata is generic", (name) => {
    const privateContent = "synthetic-private-message";
    const cause = Object.assign(new Error(privateContent), { name });
    const error = new Error("Outer failure", { cause });
    cause.cause = error;
    const event = prepareReportedEvent(
      {
        exception: { values: [{ type: "Error", value: privateContent }] },
        message: privateContent,
      },
      error
    );

    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toContain(privateContent);
  });

  test("keeps unrelated parsing failures visible", () => {
    const message = "Invalid syntax in an application fixture";
    const event = prepareReportedEvent(
      { exception: { values: [{ type: "SyntaxError", value: message }] } },
      new SyntaxError(message)
    );

    expect(event?.exception?.values?.[0]?.value).toContain(
      "application fixture"
    );
  });
});
