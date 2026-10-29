import { hrefForSurface } from "@quieter/env/hosts";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: hrefForSurface(
        "site",
        location.pathname,
        location.searchStr,
        location.hash,
        import.meta.env.DEV
      ),
    });
  },
});
