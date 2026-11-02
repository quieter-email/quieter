import "@tanstack/react-start/server-only";
import { ORPCError } from "@orpc/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UnsubscribeDocument } from "#/components/unsubscribe-document";
import type { UnsubscribePage } from "#/components/unsubscribe-document";
import { reportServerError } from "#/lib/server-error-reporting";

const pageHeaders = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

export const unsubscribePageResponse = (page: UnsubscribePage, status = 200) =>
  new Response(
    `<!doctype html>${renderToStaticMarkup(createElement(UnsubscribeDocument, { page }))}`,
    { headers: pageHeaders, status }
  );

export const handleCampaignUnsubscribe = async ({
  request,
  token,
}: {
  request: Request;
  token: string;
}): Promise<Response> => {
  if (!/^[\w-]{40,100}$/u.test(token)) {
    return unsubscribePageResponse(
      { message: "This unsubscribe link is invalid.", status: "error" },
      404
    );
  }
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim();
  if (
    contentType !== "application/x-www-form-urlencoded" &&
    contentType !== "multipart/form-data"
  ) {
    return unsubscribePageResponse(
      {
        message: "Send the one-click unsubscribe form.",
        status: "error",
      },
      415
    );
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > 4096) {
    return new Response(null, { status: 413 });
  }
  try {
    const { readLimitedRequestText } =
      await import("#/lib/unsubscribe-request.server");
    const body = await readLimitedRequestText(request, 4096);
    let oneClick: string | null = null;
    if (contentType === "application/x-www-form-urlencoded") {
      oneClick = new URLSearchParams(body).get("List-Unsubscribe");
    } else {
      const form = await new Response(body, {
        headers: {
          "content-type": request.headers.get("content-type") ?? "",
        },
      }).formData();
      const value = form.get("List-Unsubscribe");
      if (typeof value === "string") {
        oneClick = value;
      }
    }
    if (oneClick !== "One-Click") {
      return unsubscribePageResponse(
        { message: "Invalid unsubscribe request.", status: "error" },
        400
      );
    }
    const { unsubscribeCampaignRecipient } =
      await import("@quieter/orpc/campaigns");
    await unsubscribeCampaignRecipient(token);
    return unsubscribePageResponse({ status: "success" });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      return unsubscribePageResponse(
        { message: error.message, status: "error" },
        error.status
      );
    }
    if (error instanceof RangeError) {
      return new Response(null, { status: 413 });
    }
    reportServerError(error, "campaign-unsubscribe");
    return unsubscribePageResponse(
      {
        message: "Could not unsubscribe. Please try again.",
        status: "error",
      },
      500
    );
  }
};
