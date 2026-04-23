import { createRouter, parseSearchWith, stringifySearchWith } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    parseSearch: parseSearchWith((value) => value),
    routeTree,
    scrollRestoration: true,
    stringifySearch: stringifySearchWith(JSON.stringify),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
