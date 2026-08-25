import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const getDesktopAuthSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getSessionWithOrganization } =
      await import("@quieter/auth/session");
    const session = await getSessionWithOrganization(
      new Headers(getRequest().headers)
    );

    if (!session) {
      return null;
    }

    return {
      token: session.session.token,
    };
  }
);
