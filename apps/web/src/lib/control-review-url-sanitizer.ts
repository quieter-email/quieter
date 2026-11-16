import type { BrowserOptions, Event } from "@sentry/react";
import { trimPathRight } from "@tanstack/react-router";

type StreamedSpan = Parameters<
  NonNullable<BrowserOptions["beforeSendSpan"]>
>[0];

export const sanitizeControlReviewUrl = (
  value: string,
  remainingReturns = 16
): string => {
  let input = value;
  let url: URL;

  try {
    url = new URL(input, "https://telemetry.invalid");
    while (url.pathname.includes("%")) {
      const decoded = new URLSearchParams(
        `url=${input.replaceAll("&", "%26").replaceAll("+", "%2B")}`
      ).get("url");
      if (decoded === null || decoded === input) {
        break;
      }
      input = decoded;
      url = new URL(input, "https://telemetry.invalid");
    }
  } catch {
    return "[Filtered URL]";
  }
  if (trimPathRight(url.pathname).toLowerCase() === "/control/review") {
    return input.split(/[?#]/u, 1)[0] ?? "/control/review";
  }

  let changed = false;
  const search = new URLSearchParams();
  for (const [key, original] of url.searchParams) {
    let sanitized = original;
    if (key === "returnTo") {
      // Sentry sends a span unchanged if its beforeSendSpan callback throws.
      sanitized =
        remainingReturns === 0
          ? "[Filtered URL]"
          : sanitizeControlReviewUrl(original, remainingReturns - 1);
    }
    changed ||= sanitized !== original;
    search.append(key, sanitized);
  }
  if (!changed) {
    return value;
  }
  const path = input.split(/[?#]/u, 1)[0] ?? "";
  return `${path}?${search}${url.hash}`;
};

export const sanitizeControlReviewEvent = <T extends Event>(event: T): T => {
  if (event.request?.url !== undefined) {
    event.request.url = sanitizeControlReviewUrl(event.request.url);
  }
  for (const [key, value] of Object.entries(event.request?.headers ?? {})) {
    if (key.toLowerCase() === "referer" && event.request?.headers) {
      event.request.headers[key] = sanitizeControlReviewUrl(value);
    }
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.category !== "navigation" || !breadcrumb.data) {
      continue;
    }
    for (const key of ["from", "to"]) {
      const value: unknown = breadcrumb.data[key];
      if (typeof value === "string") {
        breadcrumb.data[key] = sanitizeControlReviewUrl(value);
      }
    }
  }
  for (const exception of event.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename !== undefined) {
        frame.filename = sanitizeControlReviewUrl(frame.filename);
      }
    }
  }
  return event;
};

export const sanitizeControlReviewSpan = (span: StreamedSpan): StreamedSpan => {
  for (const key of ["url.full", "http.request.header.referer"]) {
    const value = span.attributes[key];
    if (typeof value === "string") {
      span.attributes[key] = sanitizeControlReviewUrl(value);
    } else if (Array.isArray(value)) {
      span.attributes[key] = value.map((item: unknown) =>
        typeof item === "string" ? sanitizeControlReviewUrl(item) : item
      );
    }
  }
  return span;
};
