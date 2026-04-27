import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

const sitePasswordSearchSchema = z.object({
  returnTo: z.string().catch("/"),
  sitePasswordError: z
    .union([z.literal("1"), z.literal("true")])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/site-password")({
  validateSearch: zodValidator(sitePasswordSearchSchema),
  component: SitePasswordRouteComponent,
});

function SitePasswordRouteComponent() {
  const { returnTo, sitePasswordError } = Route.useSearch();

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-medium tracking-normal text-foreground">quieter</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This site is temporarily password protected.
        </p>

        <form action="/api/site-password" className="mt-6 grid gap-3" method="post">
          <input name="returnTo" type="hidden" value={returnTo} />
          <input
            autoComplete="current-password"
            autoFocus
            className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            name="password"
            placeholder="Password"
            required
            type="password"
          />
          {sitePasswordError ? (
            <p className="text-sm text-destructive">That password did not work.</p>
          ) : null}
          <button
            className="inline-flex h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            type="submit"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
