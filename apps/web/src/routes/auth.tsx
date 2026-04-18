import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionUser } from "~/lib/auth.functions";
import { toAuthSearch, toMailboxSearch } from "~/lib/search-params";

export const Route = createFileRoute("/auth")({
  loader: async () => {
    const user = await getSessionUser();

    if (user) {
      throw redirect({
        search: toMailboxSearch({}),
        to: "/",
      });
    }

    throw redirect({
      search: toAuthSearch(),
      to: "/login",
    });
  },
});
