import { handleMailUpdates } from "./mail-updates";
import { requestErrorResponse } from "./request-error";
import { withSentryReporting } from "./worker-runtime";

export { MailLiveUser } from "./mail-live-user";

export default withSentryReporting({
  async fetch(request, env) {
    try {
      return await handleMailUpdates(request, env);
    } catch (error) {
      return requestErrorResponse(error, "/mail");
    }
  },
} satisfies ExportedHandler<Env>);
