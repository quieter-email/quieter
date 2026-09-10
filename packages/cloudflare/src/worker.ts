import { withSentryReporting } from "./worker-runtime";
import { handlePubSub, requestErrorResponse } from "./worker-utils";

export default withSentryReporting({
  async fetch(request: Request, env: Env) {
    const route = new URL(request.url).pathname;
    try {
      if (route === "/gmail/pubsub" && request.method === "POST") {
        return await handlePubSub(request, env);
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return requestErrorResponse(error, route);
    }
  },
} satisfies ExportedHandler<Env>);
