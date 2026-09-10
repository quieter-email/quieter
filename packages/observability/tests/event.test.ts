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

  test("keeps unexpected failures", () => {
    const error = new Error("Unexpected provider failure");
    const event = prepareReportedEvent(
      { exception: { values: [{ value: error.message }] } },
      error
    );

    expect(event?.exception?.values?.[0]?.value).toBe(
      "Unexpected provider failure"
    );
  });
});
