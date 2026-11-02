import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/unsubscribe/$token")({
  server: {
    handlers: {
      GET: async (): Promise<Response> => {
        const { unsubscribePageResponse } =
          await import("#/lib/campaign-unsubscribe.server");
        return unsubscribePageResponse({ status: "confirmation" });
      },
      POST: async ({ request, params }): Promise<Response> => {
        const { handleCampaignUnsubscribe } =
          await import("#/lib/campaign-unsubscribe.server");
        return await handleCampaignUnsubscribe({
          request,
          token: params.token,
        });
      },
    },
  },
});
