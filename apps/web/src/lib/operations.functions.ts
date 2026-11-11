import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

export const getOperationsAccess = createServerFn({ method: "GET" }).handler(
  async () => {
    setResponseHeader("Cache-Control", "private, no-store");
    const [{ hasPlatformOperationsAccess }, { getSessionUserForRequest }] =
      await Promise.all([
        import("@quieter/orpc/operations-access"),
        import("./auth.server"),
      ]);

    const user = await getSessionUserForRequest(getRequest());
    if (user === null) {
      return "signed-out";
    }
    if (user.needsOnboarding) {
      return "onboarding";
    }
    const allowed = await hasPlatformOperationsAccess(user.id);
    return allowed ? "allowed" : "denied";
  }
);
