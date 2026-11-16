import { ORPCError } from "@orpc/server";
import { reportError } from "@quieter/observability";

export const handleOutlookCallback = async (request: Request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || url.searchParams.has("error")) {
    return Response.json(
      {
        error:
          "The mailbox connection was not completed. Start the connection again.",
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: 400,
      }
    );
  }
  try {
    const { completeOutlookOAuth } = await import("./service");
    const result = await completeOutlookOAuth({
      code,
      headers: request.headers,
      state,
    });
    return new Response(null, {
      headers: {
        "Cache-Control": "no-store",
        Location: new URL(result.returnTo, url.origin).href,
      },
      status: 302,
    });
  } catch (error) {
    const expected =
      error instanceof ORPCError && error.status >= 400 && error.status < 500;
    if (!expected) {
      reportError(error, { operation: "outlook-mail-callback" });
    }
    return Response.json(
      {
        error: expected
          ? error.message
          : "The mailbox could not be connected. Please try again.",
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: expected ? error.status : 500,
      }
    );
  }
};
