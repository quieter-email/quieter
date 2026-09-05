import { ORPCError } from "@orpc/server";
import { serverEnv } from "@quieter/env/server";

export const assertLocalMailDomain = () => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local") {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Domain registration requires a deployed environment. Use local mail fixtures for development.",
    });
  }
};

export const assertLocalMailSend = () => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local") {
    throw new ORPCError("FORBIDDEN", {
      message:
        "External mail delivery requires a deployed environment. Use local mail fixtures for development.",
    });
  }
};
