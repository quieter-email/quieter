import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useEffect } from "react";
import { z } from "zod";

import { LoadingPage } from "#/components/loading-page";
import { getDesktopAuthSession } from "#/lib/desktop-auth.functions";

const getSafeCallback = (value: string | undefined) => {
  if (value === undefined || value.length > 256) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
      url.pathname !== "/callback" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port === ""
    ) {
      return null;
    }

    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 && port < 65_536
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

const getCurrentReturnTo = (href: string) => {
  const url = new URL(href, "http://localhost");
  return `${url.pathname}${url.search}`;
};

// react-doctor-disable-next-line react-doctor/tanstack-start-route-property-order -- The repository's TanStack Router lint rule owns this generated route property order.
export const Route = createFileRoute("/desktop-auth")({
  component: DesktopAuthRouteComponent,
  loader: async ({ location }) => {
    const search = location.search as { callback?: string; state?: string };
    const callback = getSafeCallback(search.callback);
    const state = search.state?.trim();

    if (
      callback === null ||
      state === undefined ||
      state.length === 0 ||
      state.length > 128
    ) {
      return { error: "The desktop sign-in request is no longer valid." };
    }

    const session = await getDesktopAuthSession();
    if (!session) {
      throw redirect({
        search: { returnTo: getCurrentReturnTo(location.href) },
        to: "/auth",
      });
    }

    return {
      callback,
      state,
      token: session.token,
    };
  },
  pendingComponent: LoadingPage,
  ssr: "data-only",
  validateSearch: zodValidator(
    z.object({
      callback: z.string().optional(),
      state: z.string().optional(),
    })
  ),
});

function DesktopAuthRouteComponent() {
  const data = Route.useLoaderData();

  useEffect(() => {
    if (data !== undefined && "callback" in data) {
      const form =
        document.querySelector<HTMLFormElement>("#desktop-auth-form");
      form?.requestSubmit();
    }
  }, [data]);

  if (data === undefined || "error" in data) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-6 py-10 text-center text-fg">
        <div className="max-w-sm">
          <p className="font-serif text-title-md">quieter</p>
          <p className="mt-3 text-body text-muted-fg">
            {data?.error ?? "The desktop sign-in request is no longer valid."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 py-10 text-center text-fg">
      <div className="max-w-sm">
        <p className="font-serif text-title-md">quieter</p>
        <p className="mt-3 text-body text-muted-fg">
          Returning you to the desktop app...
        </p>
        <script>{`(() => {
          const payload = ${JSON.stringify({
            callback: data.callback,
            state: data.state,
            token: data.token,
          }).replaceAll("<", "\\u003c")};
          const body = new URLSearchParams({
            state: payload.state,
            token: payload.token,
          });
          if (!navigator.sendBeacon(payload.callback, body)) {
            document.querySelector("#desktop-auth-form")?.requestSubmit();
          }
        })();`}</script>
        <form action={data.callback} id="desktop-auth-form" method="post">
          <input name="state" type="hidden" value={data.state} />
          <input name="token" type="hidden" value={data.token} />
          <button
            className="mt-6 rounded-md border border-border bg-control px-4 py-2 text-body text-fg hover:bg-control-hover"
            type="submit"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
