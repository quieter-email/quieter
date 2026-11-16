import { shouldDiscardClientError } from "@quieter/app/lib/client-error-reporting";
import * as Sentry from "@sentry/react";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  sanitizeControlReviewEvent,
  sanitizeControlReviewSpan,
  sanitizeControlReviewUrl,
} from "./control-review-url-sanitizer";

type TransportFactory = NonNullable<Sentry.BrowserOptions["transport"]>;
type Envelope = Parameters<ReturnType<TransportFactory>["send"]>[0];

const privateApprovalId = "a7ad819b-782d-41c6-9596-333bcbe3337f";
const unrelatedId = "c3a3c218-849e-4b85-993f-be4e62479edc";
const reviewUrl = `https://app.quieter.test/control/review?approvalId=${privateApprovalId}`;
const unrelatedUrl = `https://app.quieter.test/documents/${unrelatedId}?approvalId=${unrelatedId}#details`;
const location = new URL("https://app.quieter.test/");
const document = { location, referrer: "" };
const history = {
  pushState(_state: unknown, _title: string, url: string) {
    location.href = new URL(url, location.origin).href;
  },
  replaceState(_state: unknown, _title: string, url: string) {
    location.href = new URL(url, location.origin).href;
  },
};

const captureReviewFailure = async (sanitize: boolean, stackless = false) => {
  Sentry.getCurrentScope().clearBreadcrumbs();
  Sentry.getIsolationScope().clearBreadcrumbs();
  const envelopes: Envelope[] = [];
  const client = Sentry.init({
    beforeSend: (event, hint) => {
      if (!sanitize) {
        return event;
      }
      return shouldDiscardClientError(event, hint.originalException)
        ? null
        : sanitizeControlReviewEvent(event);
    },
    beforeSendSpan: sanitize ? sanitizeControlReviewSpan : undefined,
    defaultIntegrations: [
      Sentry.httpContextIntegration(),
      Sentry.globalHandlersIntegration(),
      Sentry.breadcrumbsIntegration({
        dom: false,
        fetch: false,
        sentry: false,
        xhr: false,
      }),
    ],
    dsn: "https://public@sentry.invalid/1",
    sendClientReports: false,
    skipBrowserExtensionCheck: true,
    tracesSampleRate: 1,
    transport: () => ({
      // oxlint-disable-next-line eslint/require-await -- The SDK transport contract requires promises without I/O.
      flush: async () => true,
      // oxlint-disable-next-line eslint/require-await -- The SDK transport contract requires promises without I/O.
      send: async (envelope) => {
        envelopes.push(structuredClone(envelope));
        return { statusCode: 200 };
      },
    }),
  });
  document.referrer = `https://app.quieter.test/auth?returnTo=${encodeURIComponent(reviewUrl)}`;
  history.pushState(null, "", `${reviewUrl}#${privateApprovalId}`);
  history.pushState(null, "", "/settings");
  history.pushState(null, "", reviewUrl);
  Sentry.setTag("diagnosticId", unrelatedId);
  Sentry.addBreadcrumb({
    category: "navigation",
    data: { from: unrelatedUrl, to: unrelatedUrl },
  });
  if (stackless) {
    const onError = globalThis.onerror;
    if (typeof onError !== "function") {
      throw new TypeError("The installed global error handler is unavailable.");
    }
    onError("Uncaught review runtime failure", "", 0, 0);
  } else {
    Sentry.captureException(new Error("Review request failed"));
  }
  Sentry.captureException(
    Object.assign(new Error("Expected scope repair"), {
      code: "MAILBOX_SCOPE_REPAIR_REQUIRED",
    })
  );
  const span = Sentry.startInactiveSpan({
    attributes: { unrelatedUrl },
    name: "Review request",
  });
  span.end();
  await client?.close();
  return envelopes;
};

describe("control review telemetry privacy", () => {
  beforeAll(() => {
    vi.stubGlobal("location", location);
    vi.stubGlobal("document", document);
    vi.stubGlobal("history", history);
    vi.stubGlobal("onerror", null);
    vi.stubGlobal("onunhandledrejection", null);
    vi.stubGlobal("addEventListener", vi.fn());
  });

  afterAll(() => {
    Sentry.getCurrentScope().setClient(undefined);
    Sentry.getCurrentScope().clearBreadcrumbs();
    Sentry.getIsolationScope().clearBreadcrumbs();
    vi.unstubAllGlobals();
  });

  test("removes private query and fragment references through encoded sign-in returns", () => {
    const nested = `/auth?returnTo=${encodeURIComponent(`/auth?returnTo=${encodeURIComponent(`${reviewUrl}#${privateApprovalId}`)}`)}`;
    const additionallyEncoded = `/auth?returnTo=${encodeURIComponent(encodeURIComponent(reviewUrl))}`;
    for (const input of [
      reviewUrl,
      `/control/review#${privateApprovalId}`,
      nested,
      additionallyEncoded,
      `/auth?returnTo=${encodeURIComponent(reviewUrl)}&returnTo=${encodeURIComponent(`${reviewUrl}#${privateApprovalId}`)}`,
    ]) {
      expect(sanitizeControlReviewUrl(input)).not.toContain(privateApprovalId);
      expect(sanitizeControlReviewUrl(input)).toContain("control");
    }
    expect(sanitizeControlReviewUrl(unrelatedUrl)).toBe(unrelatedUrl);
    expect(
      sanitizeControlReviewUrl("https://[invalid/control/review")
    ).not.toContain("invalid");
    let deeplyNested = reviewUrl;
    for (let depth = 0; depth < 128; depth += 1) {
      deeplyNested = `/auth?returnTo=${encodeURIComponent(deeplyNested)}`;
    }
    expect(sanitizeControlReviewUrl(deeplyNested)).not.toContain(
      privateApprovalId
    );
  });

  test("scrubs actual SDK error and streamed-span envelopes while retaining useful diagnostics", async () => {
    const baseline = await captureReviewFailure(false);
    expect(JSON.stringify(baseline)).toContain(privateApprovalId);
    expect(
      baseline.flatMap(([, items]) => items.map(([header]) => header.type))
    ).toStrictEqual(expect.arrayContaining(["event", "span"]));
    expect(
      JSON.stringify(
        baseline.flatMap(([, items]) =>
          items.filter(([header]) => header.type === "span")
        )
      )
    ).toContain(privateApprovalId);

    const sanitized = await captureReviewFailure(true);
    const events = sanitized.flatMap(([, items]) =>
      items
        .filter(([header]) => header.type === "event")
        .map(([, payload]) => payload)
    );
    const spans = sanitized.flatMap(([, items]) =>
      items
        .filter(([header]) => header.type === "span")
        .map(([, payload]) => payload)
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      request: {
        headers: {
          Referer:
            "https://app.quieter.test/auth?returnTo=https%3A%2F%2Fapp.quieter.test%2Fcontrol%2Freview",
        },
        url: "https://app.quieter.test/control/review",
      },
    });
    expect(JSON.stringify(events)).toContain('"category":"navigation"');
    expect(JSON.stringify(events)).toContain('"from":"/control/review"');
    expect(JSON.stringify(events)).toContain("Review request failed");
    expect(spans).toHaveLength(1);
    expect(JSON.stringify(spans)).toContain("url.full");
    expect(JSON.stringify(spans)).toContain("http.request.header.referer");
    expect(JSON.stringify(sanitized)).not.toContain(privateApprovalId);
    expect(JSON.stringify(sanitized)).not.toContain("Expected scope repair");
    expect(JSON.stringify(events)).toContain(unrelatedUrl);
    expect(JSON.stringify(spans)).toContain(unrelatedUrl);
    expect(JSON.stringify(events)).toContain(unrelatedId);
  });

  test("scrubs the current URL when the installed global handler creates a fallback stack frame", async () => {
    const baseline = await captureReviewFailure(false, true);
    const originalEvents = baseline.flatMap(([, items]) =>
      items
        .filter(([header]) => header.type === "event")
        .map(([, payload]) => payload)
    );
    expect(originalEvents[0]).toMatchObject({
      exception: {
        values: [{ stacktrace: { frames: [{ filename: reviewUrl }] } }],
      },
    });
    const sanitized = await captureReviewFailure(true, true);
    const events = sanitized.flatMap(([, items]) =>
      items
        .filter(([header]) => header.type === "event")
        .map(([, payload]) => payload)
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ filename: "https://app.quieter.test/control/review" }],
            },
          },
        ],
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain(privateApprovalId);
    expect(JSON.stringify(events)).toContain("Uncaught review runtime failure");
  });
});
