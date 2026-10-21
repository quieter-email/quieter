import type { router } from "./router";

declare module "@tanstack/react-router" {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack's registry is an augmented interface.
  interface Register {
    router: typeof router;
  }
}
