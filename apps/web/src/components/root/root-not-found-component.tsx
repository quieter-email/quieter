import { Link } from "@tanstack/react-router";

export const RootNotFoundComponent = () => (
  <div className="grid min-h-dvh place-items-center bg-bg px-6 py-10">
    <div className="w-full max-w-xl rounded-2xl border bg-bg-surface p-8 shadow-sm">
      <h1 className="text-3xl font-medium tracking-tight text-fg">
        Page not found
      </h1>
      <p className="mt-3 text-sm text-muted-fg">
        The route you requested does not exist.
      </p>
      <Link
        className="mt-6 inline-flex rounded-md border border-border bg-bg px-4 py-2 text-sm text-fg shadow-sm hover:border-fg/25 hover:bg-muted/60"
        to="/"
      >
        Go to inbox
      </Link>
    </div>
  </div>
);
