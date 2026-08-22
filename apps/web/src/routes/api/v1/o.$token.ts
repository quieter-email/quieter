import { serverEnv } from "@quieter/env/server";
import { verifyOpenTrackingToken } from "@quieter/mail/tracking";
import { createFileRoute } from "@tanstack/react-router";

import { reportServerError } from "#/lib/server-error-reporting";

const TRANSPARENT_GIF = Uint8Array.from(
  Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  )
);

const gifResponse = () =>
  new Response(TRANSPARENT_GIF, {
    headers: {
      // Mail clients and privacy proxies cache aggressively; never let a
      // cached marker stand in for a fresh load.
      "cache-control": "no-store, private",
      "content-type": "image/gif",
      "cross-origin-resource-policy": "cross-origin",
    },
  });

export const Route = createFileRoute("/api/v1/o/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const secret = serverEnv.BETTER_AUTH_SECRET;
        const messageHeaderId =
          params.token !== "" && secret !== undefined && secret !== ""
            ? verifyOpenTrackingToken(params.token, secret)
            : null;

        if (messageHeaderId === null) {
          return gifResponse();
        }

        try {
          const { recordOrganizationMailMarkerLoad } =
            await import("@quieter/orpc/organization-mail-delivery");
          await recordOrganizationMailMarkerLoad({
            messageHeaderId,
            occurredAt: new Date(),
          });
        } catch (error) {
          reportServerError(error, "open-tracking-marker");
        }

        return gifResponse();
      },
    },
  },
});
